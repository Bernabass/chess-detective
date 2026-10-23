//go:build integration

package httpapi_test

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/ratelimit"
)

// sessionToken is the client's current session cookie value ("" if none).
func (c *client) sessionToken() string {
	u, _ := url.Parse(c.api.srv.URL)
	for _, ck := range c.http.Jar.Cookies(u) {
		if ck.Name == auth.CookieName {
			return ck.Value
		}
	}
	return ""
}

// withToken is a fresh client that presents token as its session cookie.
func (a *testAPI) withToken(token string) *client {
	c := a.client()
	u, _ := url.Parse(a.srv.URL)
	c.http.Jar.SetCookies(u, []*http.Cookie{{Name: auth.CookieName, Value: token, Path: "/"}}) //nolint:gosec // a client-side test cookie
	return c
}

func TestRegisterMergesGuestAndRotates(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	c.guess(3, api.today().solution)
	guestToken := c.sessionToken()

	r := c.register("Holmes_221b")
	expectStatus(t, r, http.StatusCreated)
	me := r.json(t)
	if me["guest"] != false || me["username"] != "Holmes_221b" {
		t.Fatalf("register = %v", me)
	}
	stats := me["stats"].(map[string]any)
	if stats["played"] != float64(1) || stats["solved"] != float64(1) || stats["currentStreak"] != float64(1) {
		t.Fatalf("the guest's solve didn't move to the account: %v", stats)
	}
	if c.sessionToken() == guestToken || c.sessionToken() == "" {
		t.Fatal("the session wasn't rotated")
	}
	if api.withToken(guestToken).get("/api/auth/me").json(t)["guest"] != true {
		t.Fatal("the old guest token still signs in")
	}
	if n := api.count("SELECT count(*) FROM players WHERE user_id IS NULL"); n != 0 {
		t.Fatalf("the merged guest player is still there (%d guests)", n)
	}
	if n := api.count("SELECT count(*) FROM users WHERE password_hash LIKE '$argon2id$%'"); n != 1 {
		t.Fatal("the password isn't stored as an argon2id hash")
	}

	// Usernames are unique regardless of case.
	expectProblem(t, api.client().register("holmes_221B"), http.StatusConflict)
	// The contract: 3–20 of [A-Za-z0-9_-], passwords of 8–128 characters.
	for _, body := range []map[string]any{
		{"username": "ab", "password": "a long password"},
		{"username": "no spaces", "password": "a long password"},
		{"username": "watson", "password": "short"},
		{"username": "watson", "password": strings.Repeat("x", 129)},
		{"username": "watson", "password": "a long password", "admin": true},
	} {
		expectProblem(t, api.client().post("/api/auth/register", body), http.StatusBadRequest)
	}
}

func TestLoginLogout(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	expectStatus(t, api.client().register("watson"), http.StatusCreated)

	c := api.client()
	expectProblem(t, c.post("/api/auth/login", map[string]any{"username": "watson", "password": "the wrong one"}), http.StatusUnauthorized)
	expectProblem(t, c.post("/api/auth/login", map[string]any{"username": "nobody", "password": "a long password"}), http.StatusUnauthorized)

	// A guest who solved today's puzzle logs in: the solve moves to the account.
	c.start(3)
	c.guess(3, api.today().solution)
	guestToken := c.sessionToken()
	r := c.post("/api/auth/login", map[string]any{"username": "WATSON", "password": "a long password"})
	expectStatus(t, r, http.StatusOK)
	if me := r.json(t); me["username"] != "watson" || me["stats"].(map[string]any)["solved"] != float64(1) {
		t.Fatalf("login = %v", me)
	}
	token := c.sessionToken()
	if token == guestToken {
		t.Fatal("login didn't rotate the session")
	}

	r = c.post("/api/auth/logout", map[string]any{})
	expectStatus(t, r, http.StatusNoContent)
	if !strings.Contains(r.header.Get("Set-Cookie"), "Max-Age=0") {
		t.Errorf("logout didn't clear the cookie: %q", r.header.Get("Set-Cookie"))
	}
	if api.withToken(token).get("/api/auth/me").json(t)["guest"] != true {
		t.Fatal("the session still works after logout")
	}
}

func TestLoginKeepsTheAccountsOwnAttempt(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	acct := api.client()
	expectStatus(t, acct.register("lestrade"), http.StatusCreated)
	acct.start(3)
	for range 6 {
		acct.guess(3, wrongGuess(11))
	}

	// A guest solves the same puzzle, then logs in: the account's own (failed) attempt stays.
	guest := api.client()
	guest.start(3)
	guest.guess(3, api.today().solution)
	r := guest.post("/api/auth/login", map[string]any{"username": "lestrade", "password": "a long password"})
	expectStatus(t, r, http.StatusOK)
	stats := r.json(t)["stats"].(map[string]any)
	if stats["played"] != float64(1) || stats["solved"] != float64(0) {
		t.Fatalf("stats after merge = %v", stats)
	}
	if n := api.count("SELECT count(*) FROM attempts"); n != 1 {
		t.Fatalf("%d attempts, want 1 (the guest's duplicate goes with the guest)", n)
	}
}

func TestCSRF(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	body := map[string]any{}

	expectProblem(t, c.do(http.MethodPost, "/api/daily/3/start", body, "Origin", "https://evil.example"), http.StatusForbidden)
	expectProblem(t, c.do(http.MethodPost, "/api/daily/3/start", body, "Origin", ""), http.StatusForbidden)
	expectProblem(t, c.do(http.MethodPost, "/api/daily/3/start", body, "Content-Type", "text/plain"), http.StatusUnsupportedMediaType)
	expectProblem(t, c.do(http.MethodPost, "/api/daily/3/start", body, "Content-Type", "application/x-www-form-urlencoded"), http.StatusUnsupportedMediaType)
	if n := api.count("SELECT count(*) FROM players"); n != 0 {
		t.Fatalf("rejected requests created %d players", n)
	}
	expectStatus(t, c.post("/api/daily/3/start", body), http.StatusOK)
}

func TestSecurityHeaders(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	r := api.client().get("/api/daily")
	for header, want := range map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "no-referrer",
		"X-Frame-Options":         "DENY",
		"Content-Security-Policy": "default-src 'none'",
		"Cache-Control":           "no-store",
	} {
		if got := r.header.Get(header); !strings.Contains(got, want) {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestSlidingExpiry(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	token := c.sessionToken()

	// Within the touch interval: nothing is written and no cookie is sent.
	api.clock.Advance(30 * time.Minute)
	if sc := c.get("/api/auth/me").header.Get("Set-Cookie"); sc != "" {
		t.Fatalf("a refresh within the hour: %q", sc)
	}
	// After an hour, the expiry slides and the cookie is reissued with the same token.
	api.clock.Advance(31 * time.Minute)
	if sc := c.get("/api/auth/me").header.Get("Set-Cookie"); !strings.Contains(sc, token) {
		t.Fatalf("no refresh after an hour: %q", sc)
	}
	var expires time.Time
	if err := api.db.QueryRow(t.Context(), "SELECT expires_at FROM sessions").Scan(&expires); err != nil {
		t.Fatal(err)
	}
	if want := api.clock.Now().Add(auth.SessionTTL); !expires.Equal(want) {
		t.Fatalf("expires_at = %v, want %v", expires, want)
	}

	// Unused for longer than the TTL, the session is gone.
	api.clock.Advance(auth.SessionTTL + time.Minute)
	if me := c.get("/api/auth/me").json(t); me["guest"] != true {
		t.Fatalf("an expired session: %v", me)
	}
	expectProblem(t, c.guess(3, api.today().solution), http.StatusConflict)
}

func TestRateLimits(t *testing.T) {
	t.Parallel()
	api := newAPI(t, func(clk clock.Clock) httpapi.Limits {
		return httpapi.Limits{
			AuthPerIP:     ratelimit.New(clk, 3, time.Minute),
			PlayPerPlayer: ratelimit.New(clk, 2, time.Minute),
			StartPerIP:    ratelimit.New(clk, 2, time.Hour),
		}
	})
	c := api.client()

	c.start(3)
	c.start(3)
	r := c.post("/api/daily/3/start", map[string]any{})
	expectProblem(t, r, http.StatusTooManyRequests)
	if s, err := strconv.Atoi(r.header.Get("Retry-After")); err != nil || s < 1 {
		t.Fatalf("Retry-After = %q", r.header.Get("Retry-After"))
	}

	expectStatus(t, c.hint(3), http.StatusOK)
	expectStatus(t, c.guess(3, wrongGuess(11)), http.StatusOK)
	expectProblem(t, c.guess(3, wrongGuess(11)), http.StatusTooManyRequests)
	if n := api.count("SELECT count(*) FROM guesses"); n != 1 {
		t.Fatalf("a rate-limited guess was stored (%d guesses)", n)
	}
	api.clock.Advance(time.Minute)
	expectStatus(t, c.guess(3, wrongGuess(11)), http.StatusOK)

	for i := range 3 {
		c.post("/api/auth/login", map[string]any{"username": "nobody" + strconv.Itoa(i), "password": "a long password"})
	}
	expectProblem(t, c.post("/api/auth/login", map[string]any{"username": "other", "password": "a long password"}), http.StatusTooManyRequests)
}

// The cookie's lifetime comes from the injected clock, not the wall clock.
func TestCookieMaxAgeUsesTheClock(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.clock.Set(time.Date(2031, 6, 1, 12, 0, 0, 0, time.UTC)) // years after the puzzles: fine for /auth/register
	sc := api.client().register("future").header.Get("Set-Cookie")
	if want := fmt.Sprintf("Max-Age=%d", int(auth.SessionTTL.Seconds())); !strings.Contains(sc, want) {
		t.Fatalf("Set-Cookie %q lacks %s", sc, want)
	}
}

func TestRateLimitPerUsername(t *testing.T) {
	t.Parallel()
	api := newAPI(t, func(clk clock.Clock) httpapi.Limits {
		return httpapi.Limits{AuthPerUsername: ratelimit.New(clk, 2, time.Minute)}
	})
	login := func(username string) response {
		return api.client().post("/api/auth/login", map[string]any{"username": username, "password": "a long password"})
	}
	expectProblem(t, login("Watson"), http.StatusUnauthorized)
	expectProblem(t, login("watson"), http.StatusUnauthorized)
	r := login("WATSON") // the same username in any case
	expectProblem(t, r, http.StatusTooManyRequests)
	if r.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	expectProblem(t, login("holmes"), http.StatusUnauthorized) // another username is unaffected
}
