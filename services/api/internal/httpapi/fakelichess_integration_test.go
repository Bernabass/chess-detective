//go:build integration

package httpapi_test

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
)

// fakeLichess plays lichess.org for the OAuth tests, following its API spec: GET /oauth
// "approves" as the chosen user (or denies), POST /api/token checks the PKCE pair, the
// redirect_uri and the client_id (form-encoded), GET /api/account answers for the token, and
// DELETE /api/token revokes it. It remembers every secret it handed out, so tests can check
// none of them reached a log.
type fakeLichess struct {
	srv *httptest.Server

	mu sync.Mutex
	// What the next authorization does: approve as this user, or deny.
	user lichess.Account
	deny bool
	// Failures to inject.
	tokenError   string // POST /api/token answers 400 with this OAuth error
	accountError bool   // GET /api/account answers 500
	revokeError  bool   // DELETE /api/token answers 500 (the token stays alive)
	// What happened.
	codes    map[string]pending // code -> what it was issued for
	tokens   map[string]lichess.Account
	issued   []string // every code and token
	revoked  []string
	exchange int // calls to POST /api/token
	clientID string
}

type pending struct {
	challenge, redirectURI, clientID string
	user                             lichess.Account
}

func secret(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func newFakeLichess(t *testing.T) *fakeLichess {
	t.Helper()
	f := &fakeLichess{codes: map[string]pending{}, tokens: map[string]lichess.Account{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /oauth", f.authorize)
	mux.HandleFunc("POST /api/token", f.token)
	mux.HandleFunc("GET /api/account", f.account)
	mux.HandleFunc("DELETE /api/token", f.revoke)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeLichess) set(fn func(f *fakeLichess)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *fakeLichess) authorize(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q := r.URL.Query()
	redirect := q.Get("redirect_uri")
	if q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" ||
		q.Get("client_id") == "" || redirect == "" || q.Has("scope") {
		http.Error(w, "bad authorization request", http.StatusBadRequest)
		return
	}
	back := url.Values{"state": {q.Get("state")}}
	if f.deny {
		back.Set("error", "access_denied")
		back.Set("error_description", "user cancelled authorization")
	} else {
		code := secret("liu_")
		f.codes[code] = pending{challenge: q.Get("code_challenge"), redirectURI: redirect, clientID: q.Get("client_id"), user: f.user}
		f.issued = append(f.issued, code)
		back.Set("code", code)
	}
	// Like Lichess: back to the client's redirect_uri (a fake server inside a test).
	http.Redirect(w, r, redirect+"?"+back.Encode(), http.StatusFound) //nolint:gosec // see above
}

func oauthError(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code, "error_description": "fake says no"})
}

func (f *fakeLichess) token(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exchange++
	if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || r.ParseForm() != nil {
		oauthError(w, "invalid_request")
		return
	}
	if f.tokenError != "" {
		oauthError(w, f.tokenError)
		return
	}
	code := r.PostForm.Get("code")
	p, ok := f.codes[code]
	delete(f.codes, code) // codes are single use
	switch {
	case r.PostForm.Get("grant_type") != "authorization_code", !ok:
		oauthError(w, "invalid_grant")
	case lichess.Challenge(r.PostForm.Get("code_verifier")) != p.challenge:
		oauthError(w, "invalid_grant") // PKCE: the verifier must hash to the challenge
	case r.PostForm.Get("redirect_uri") != p.redirectURI, r.PostForm.Get("client_id") != p.clientID:
		oauthError(w, "invalid_grant")
	default:
		token := secret("lio_")
		f.tokens[token] = p.user
		f.issued = append(f.issued, token)
		f.clientID = p.clientID
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"token_type": "Bearer", "access_token": token, "expires_in": 31536000})
	}
}

func (f *fakeLichess) bearer(r *http.Request) (string, lichess.Account, bool) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	user, ok := f.tokens[token]
	return token, user, ok
}

func (f *fakeLichess) account(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, user, ok := f.bearer(r)
	switch {
	case !ok:
		http.Error(w, `{"error":"No such token"}`, http.StatusUnauthorized)
	case f.accountError:
		http.Error(w, `{"error":"boom"}`, http.StatusInternalServerError)
	default:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": user.ID, "username": user.Username, "perfs": map[string]any{}})
	}
}

func (f *fakeLichess) revoke(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	token, _, ok := f.bearer(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if f.revokeError {
		http.Error(w, `{"error":"boom"}`, http.StatusInternalServerError)
		return
	}
	delete(f.tokens, token)
	f.revoked = append(f.revoked, token)
	w.WriteHeader(http.StatusNoContent)
}

// secrets are every code and token the fake issued (to look for in logs and the database).
func (f *fakeLichess) secrets() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.issued...)
}

// state reads the fake's bookkeeping under its lock.
func (f *fakeLichess) state() (live, revoked, exchanges int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.tokens), len(f.revoked), f.exchange
}
