//go:build integration

package httpapi_test

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
	"github.com/Bernabass/chess-detective/services/api/internal/ratelimit"
)

// hopResult is one navigation's answer (the body is already closed).
type hopResult struct {
	status int
	header http.Header
}

// hop does one browser navigation without following the redirect.
func (c *client) hop(rawURL string) hopResult {
	c.api.t.Helper()
	noFollow := &http.Client{Jar: c.http.Jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, rawURL, nil)
	if err != nil {
		c.api.t.Fatal(err)
	}
	resp, err := noFollow.Do(req)
	if err != nil {
		c.api.t.Fatal(err)
	}
	_ = resp.Body.Close()
	return hopResult{status: resp.StatusCode, header: resp.Header}
}

func location(t *testing.T, r hopResult) string {
	t.Helper()
	if r.status != http.StatusFound {
		t.Fatalf("status %d, want a 302", r.status)
	}
	return r.header.Get("Location")
}

// startLichess is "Sign in with Lichess": it returns the authorization URL at the fake Lichess.
func (c *client) startLichess(returnTo string) string {
	c.api.t.Helper()
	return location(c.api.t, c.hop(c.api.srv.URL+"/api/auth/lichess/start?return_to="+url.QueryEscape(returnTo)))
}

// approve is the user at Lichess: it returns the callback URL Lichess sends the browser to.
func (c *client) approve(authorizeURL string) string {
	c.api.t.Helper()
	return location(c.api.t, c.hop(authorizeURL))
}

// callback finishes the flow and returns where the browser is sent.
func (c *client) callback(callbackURL string) string {
	c.api.t.Helper()
	return location(c.api.t, c.hop(callbackURL))
}

func (c *client) lichessSignIn(returnTo string) string {
	c.api.t.Helper()
	return c.callback(c.approve(c.startLichess(returnTo)))
}

func (c *client) me() map[string]any {
	c.api.t.Helper()
	return c.get("/api/auth/me").json(c.api.t)
}

func (a *testAPI) setLichessUser(id, username string) {
	a.lichess.set(func(f *fakeLichess) { f.user = lichess.Account{ID: id, Username: username} })
}

func TestLichessSignInCreatesAnAccountAndMergesTheGuest(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("thibault", "Thibault")
	c := api.client()
	c.start(3)
	c.guess(3, wrongGuess(11))

	authorize, err := url.Parse(c.startLichess("/daily/3"))
	if err != nil {
		t.Fatal(err)
	}
	// Identity only (no scope), our client id, and the callback as the redirect URI.
	q := authorize.Query()
	if q.Has("scope") || q.Get("client_id") != "localhost:5173" || q.Get("redirect_uri") != api.srv.URL+"/api/auth/lichess/callback" {
		t.Errorf("authorization request = %s", authorize.RawQuery)
	}
	if got := c.callback(c.approve(authorize.String())); got != "/daily/3" {
		t.Fatalf("sent to %q, want /daily/3", got)
	}

	me := c.me()
	if me["guest"] != false || me["username"] != "Thibault" {
		t.Fatalf("me = %v", me)
	}
	// The guest's guess came along.
	attempt := c.get("/api/daily/3").json(t)["attempt"].(map[string]any)
	if n := len(attempt["guesses"].([]any)); n != 1 {
		t.Fatalf("%d guesses after the merge, want 1", n)
	}
	if n := api.count("SELECT count(*) FROM players WHERE user_id IS NULL"); n != 0 {
		t.Errorf("%d guest players left", n)
	}
	// The state is used up, and the token was revoked at once.
	if n := api.count("SELECT count(*) FROM oauth_states"); n != 0 {
		t.Errorf("%d OAuth states left", n)
	}
	if live, revoked, exchanges := api.lichess.state(); live != 0 || revoked != 1 || exchanges != 1 {
		t.Errorf("tokens live %d, revoked %d, exchanges %d; want 0, 1, 1", live, revoked, exchanges)
	}
	// The profile links to Lichess.
	profile := c.get("/api/users/Thibault").json(t)
	link, _ := profile["lichess"].(map[string]any)
	if link["username"] != "Thibault" || link["url"] != "https://lichess.org/@/thibault" {
		t.Fatalf("profile lichess = %v", profile["lichess"])
	}
}

// Never link by username: a Lichess user whose name matches an existing account gets a new
// account; only the Lichess id finds an account again (owner's rule, Phase 8).
func TestLichessSignInFindsAccountsByLichessIDOnly(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	magnus := api.client()
	expectStatus(t, magnus.register("magnus"), http.StatusCreated)

	api.setLichessUser("magnus", "Magnus")
	c := api.client()
	if got := c.lichessSignIn("/daily"); got != "/daily" {
		t.Fatalf("sent to %q", got)
	}
	if me := c.me(); me["username"] != "Magnus-2" {
		t.Fatalf("signed in as %v, want a new account Magnus-2", me["username"])
	}
	// The password account is untouched: still signed in, no Lichess id, nothing merged into it.
	if me := magnus.me(); me["username"] != "magnus" || me["guest"] != false {
		t.Fatalf("magnus's own session = %v", me)
	}
	if n := api.count("SELECT count(*) FROM users WHERE username = 'magnus' AND lichess_user_id IS NULL"); n != 1 {
		t.Fatal("the password account was linked to Lichess")
	}

	// The same Lichess account, its name now in other letters: the same Retrograde account.
	api.setLichessUser("magnus", "MAGNUS")
	again := api.client()
	again.lichessSignIn("/daily")
	if me := again.me(); me["username"] != "Magnus-2" {
		t.Fatalf("second sign-in as %v, want Magnus-2", me["username"])
	}
	if n := api.count("SELECT count(*) FROM users"); n != 2 {
		t.Fatalf("%d users, want 2", n)
	}
	if n := api.count("SELECT count(*) FROM users WHERE lichess_username = 'MAGNUS'"); n != 1 {
		t.Error("the Lichess name wasn't refreshed")
	}

	// A 2-letter Lichess name becomes a valid username.
	api.setLichessUser("ab", "ab")
	short := api.client()
	short.lichessSignIn("/daily")
	if me := short.me(); me["username"] != "ab-2" {
		t.Fatalf("2-letter name signed in as %v, want ab-2", me["username"])
	}
}

// Login CSRF: an attacker's callback link (their state and code) can't sign anyone else in.
func TestLichessStateMustBelongToThisBrowser(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("attacker", "Attacker")
	attacker := api.client()
	link := attacker.approve(attacker.startLichess("/daily"))

	victim := api.client()
	victim.start(3)
	victim.startLichess("/daily") // the victim's own sign-in, so they hold a state cookie too
	if got := victim.callback(link); got != "/login?lichess=expired" {
		t.Fatalf("victim sent to %q", got)
	}
	// Neither state was used up by the forged callback.
	if n := api.count("SELECT count(*) FROM oauth_states"); n != 2 {
		t.Errorf("%d OAuth states left, want both (the attacker's and the victim's)", n)
	}
	if me := victim.me(); me["guest"] != true {
		t.Fatalf("the victim was signed in: %v", me)
	}
	if _, _, exchanges := api.lichess.state(); exchanges != 0 {
		t.Fatal("the attacker's code was exchanged")
	}
}

func TestLichessStateIsSingleUseAndExpires(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("thibault", "Thibault")

	// No state at all.
	if got := api.client().callback(api.srv.URL + "/api/auth/lichess/callback?code=liu_x"); got != "/login?lichess=expired" {
		t.Fatalf("no state: sent to %q", got)
	}

	// Used once, then replayed with the same cookie.
	c := api.client()
	authorize := c.startLichess("/daily")
	state, _ := url.Parse(authorize)
	cb := c.approve(authorize)
	c.callback(cb)
	srvURL, _ := url.Parse(api.srv.URL + "/api/auth/lichess/")
	c.http.Jar.SetCookies(srvURL, []*http.Cookie{{Name: "rg_oauth", Value: state.Query().Get("state"), Path: "/api/auth/lichess"}}) //nolint:gosec // a test cookie
	if got := c.callback(cb); got != "/login?lichess=expired" {
		t.Fatalf("replayed callback: sent to %q", got)
	}

	// Older than 10 minutes.
	late := api.client()
	cb = late.approve(late.startLichess("/daily"))
	api.clock.Advance(10*time.Minute + time.Second)
	if got := late.callback(cb); got != "/login?lichess=expired" {
		t.Fatalf("expired state: sent to %q", got)
	}
	if _, _, exchanges := api.lichess.state(); exchanges != 1 {
		t.Fatalf("%d code exchanges, want only the first sign-in's", exchanges)
	}
}

func TestLichessCancelAndFailures(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("thibault", "Thibault")

	api.lichess.set(func(f *fakeLichess) { f.deny = true })
	if got := api.client().lichessSignIn("/daily"); got != "/login?lichess=cancelled" {
		t.Fatalf("cancelled: sent to %q", got)
	}

	api.lichess.set(func(f *fakeLichess) { f.deny, f.tokenError = false, "invalid_grant" })
	if got := api.client().lichessSignIn("/daily"); got != "/login?lichess=failed" {
		t.Fatalf("token error: sent to %q", got)
	}

	// The account can't be read: no sign-in, but the token is still revoked.
	api.lichess.set(func(f *fakeLichess) { f.tokenError, f.accountError = "", true })
	c := api.client()
	if got := c.lichessSignIn("/daily"); got != "/login?lichess=failed" {
		t.Fatalf("account error: sent to %q", got)
	}
	if live, revoked, _ := api.lichess.state(); live != 0 || revoked != 1 {
		t.Fatalf("tokens live %d, revoked %d; want 0 and 1", live, revoked)
	}
	if n := api.count("SELECT count(*) FROM users"); n != 0 {
		t.Fatalf("%d users created by failed sign-ins", n)
	}
	if me := c.me(); me["guest"] != true {
		t.Fatalf("signed in after a failure: %v", me)
	}
}

// Lichess tokens, codes and states never reach a log or the database.
func TestLichessSecretsAreNeverLoggedOrStored(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("thibault", "Thibault")
	var states []string
	run := func() {
		c := api.client()
		authorize := c.startLichess("/daily")
		u, _ := url.Parse(authorize)
		states = append(states, u.Query().Get("state"))
		c.callback(c.approve(authorize))
	}
	run() // success
	api.lichess.set(func(f *fakeLichess) { f.accountError = true })
	run() // the account can't be read
	api.lichess.set(func(f *fakeLichess) { f.accountError, f.revokeError = false, true })
	run() // revoking the token fails: logged, without the token
	api.lichess.set(func(f *fakeLichess) { f.revokeError, f.deny = false, true })
	run() // cancelled
	// A forged callback with a made-up code.
	api.client().callback(api.srv.URL + "/api/auth/lichess/callback?code=liu_forged_code_value&state=forged_state_value")

	logs := api.logs.String()
	secrets := append(api.lichess.secrets(), states...)
	secrets = append(secrets, "liu_forged_code_value", "forged_state_value")
	for _, s := range secrets {
		if s != "" && strings.Contains(logs, s) {
			t.Errorf("a secret reached the logs: %s", s[:8])
		}
	}
	for _, word := range []string{"verifier", "access_token", "Bearer"} {
		if strings.Contains(logs, word) {
			t.Errorf("the logs mention %q", word)
		}
	}
	for _, logged := range []string{"lichess sign-in failed", "revoking the Lichess token failed"} {
		if !strings.Contains(logs, logged) {
			t.Errorf("%q wasn't logged (the test would prove nothing)", logged)
		}
	}
	// Nowhere to store a token: no such column anywhere in the schema.
	if n := api.count(`SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND column_name LIKE '%token%' AND column_name <> 'token_hash'`); n != 0 {
		t.Errorf("%d columns that could hold a token", n)
	}
}

func TestLichessStartIsRateLimitedAndRedirectsSafely(t *testing.T) {
	t.Parallel()
	api := newAPI(t, func(clk clock.Clock) httpapi.Limits {
		return httpapi.Limits{OAuthStartPerIP: ratelimit.New(clk, 2, time.Minute)}
	})
	api.setLichessUser("thibault", "Thibault")
	c := api.client()

	r := c.hop(api.srv.URL + "/api/auth/lichess/start?return_to=" + url.QueryEscape("//evil.example/steal"))
	cookie := r.header.Get("Set-Cookie")
	for _, want := range []string{"rg_oauth=", "Path=/api/auth/lichess", "Max-Age=600", "HttpOnly", "SameSite=Lax"} {
		if !strings.Contains(cookie, want) {
			t.Errorf("Set-Cookie %q lacks %q", cookie, want)
		}
	}
	// An off-site return_to becomes /daily.
	if got := c.callback(c.approve(location(t, r))); got != "/daily" {
		t.Fatalf("off-site return_to: sent to %q", got)
	}

	c.startLichess("/daily")
	if got := c.startLichess("/daily"); got != "/login?lichess=busy" {
		t.Fatalf("third start in a minute: sent to %q", got)
	}
}

func TestLichessSignInClearsTheStateCookie(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("thibault", "Thibault")
	c := api.client()
	r := c.hop(c.approve(c.startLichess("/daily")))
	cleared := false
	for _, sc := range r.header.Values("Set-Cookie") {
		if strings.HasPrefix(sc, "rg_oauth=;") && strings.Contains(sc, "Max-Age=0") {
			cleared = true
		}
	}
	if !cleared {
		t.Fatalf("the state cookie wasn't cleared: %v", r.header.Values("Set-Cookie"))
	}
}

// A signed-in password user who signs in with Lichess switches accounts: nothing is linked or
// merged into the password account, and the old session is rotated away.
func TestLichessSignInFromAPasswordAccountLinksNothing(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	expectStatus(t, c.register("holmes"), http.StatusCreated)
	oldToken := c.sessionToken()
	api.setLichessUser("sherlock", "Sherlock")
	c.lichessSignIn("/daily")
	if me := c.me(); me["username"] != "Sherlock" {
		t.Fatalf("signed in as %v", me["username"])
	}
	if api.withToken(oldToken).me()["guest"] != true {
		t.Error("the password account's session survived")
	}
	if n := api.count("SELECT count(*) FROM users WHERE username = 'holmes' AND lichess_user_id IS NULL"); n != 1 {
		t.Error("the password account was linked to Lichess")
	}
}

// Two first-time sign-ins of one Lichess account at once end in one account, both signed in.
func TestConcurrentFirstLichessSignIns(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.setLichessUser("twins", "Twins")
	a, b := api.client(), api.client()
	cbA, cbB := a.approve(a.startLichess("/daily")), b.approve(b.startLichess("/daily"))
	var wg sync.WaitGroup
	got := make([]string, 2)
	wg.Go(func() { got[0] = a.callback(cbA) })
	wg.Go(func() { got[1] = b.callback(cbB) })
	wg.Wait()
	if got[0] != "/daily" || got[1] != "/daily" {
		t.Fatalf("sent to %v, want /daily twice", got)
	}
	if n := api.count("SELECT count(*) FROM users"); n != 1 {
		t.Fatalf("%d users, want 1", n)
	}
}

// Someone who registers name, name-2 … name-20 can't lock the Lichess user out.
func TestSquattedLichessNamesStillGetAnAccount(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	if _, err := api.db.Exec(t.Context(), `
		INSERT INTO users (username) SELECT 'taken' UNION ALL SELECT 'taken-' || n FROM generate_series(2, 20) AS n`); err != nil {
		t.Fatal(err)
	}
	api.setLichessUser("taken", "taken")
	c := api.client()
	if got := c.lichessSignIn("/daily"); got != "/daily" {
		t.Fatalf("sent to %q", got)
	}
	name, _ := c.me()["username"].(string)
	if !regexp.MustCompile(`^taken-[0-9]{6}$`).MatchString(name) {
		t.Fatalf("signed in as %q, want taken-<6 digits>", name)
	}
}

func TestMalformedLichessCallbackGoesToTheSignInPage(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	if got := api.client().callback(api.srv.URL + "/api/auth/lichess/callback?state=a&state=b"); got != "/login?lichess=failed" {
		t.Fatalf("sent to %q", got)
	}
}
