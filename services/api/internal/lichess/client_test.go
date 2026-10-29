package lichess

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func newClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	base, _ := url.Parse(srv.URL)
	return &Client{BaseURL: base, ClientID: "localhost:5173", HTTP: srv.Client()}
}

// RFC 7636, appendix B.
func TestChallengeIsBase64URLOfSHA256(t *testing.T) {
	if got := Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"); got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("Challenge = %q", got)
	}
}

func TestNewSecretIsLongEnoughForLichess(t *testing.T) {
	a, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewSecret()
	// Lichess rejects a code_verifier shorter than 43 characters.
	if len(a) != 43 || a == b || strings.ContainsAny(a, "+/=") {
		t.Fatalf("NewSecret = %q, %q", a, b)
	}
}

func TestAuthorizeURL(t *testing.T) {
	base, _ := url.Parse("https://lichess.org")
	c := &Client{BaseURL: base, ClientID: "localhost:5173"}
	u, err := url.Parse(c.AuthorizeURL("http://localhost:5173/api/auth/lichess/callback", "the-state", "the-challenge"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme+"://"+u.Host+u.Path != "https://lichess.org/oauth" {
		t.Errorf("endpoint = %s", u)
	}
	want := url.Values{
		"response_type":         {"code"},
		"client_id":             {"localhost:5173"},
		"redirect_uri":          {"http://localhost:5173/api/auth/lichess/callback"},
		"code_challenge_method": {"S256"},
		"code_challenge":        {"the-challenge"},
		"state":                 {"the-state"},
	}
	if u.Query().Encode() != want.Encode() {
		t.Errorf("query = %s, want %s (identity only: no scope)", u.Query().Encode(), want.Encode())
	}
}

func TestExchangeSendsTheFormAndReturnsTheToken(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/token" {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			t.Errorf("Content-Type = %q", ct)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		want := url.Values{
			"grant_type":    {"authorization_code"},
			"code":          {"liu_code"},
			"code_verifier": {"verifier"},
			"redirect_uri":  {"http://localhost:5173/api/auth/lichess/callback"},
			"client_id":     {"localhost:5173"},
		}
		if r.PostForm.Encode() != want.Encode() {
			t.Errorf("form = %s", r.PostForm.Encode())
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"token_type": "Bearer", "access_token": "lio_token", "expires_in": 31536000})
	})
	token, err := c.Exchange(t.Context(), "liu_code", "verifier", "http://localhost:5173/api/auth/lichess/callback")
	if err != nil || token != "lio_token" {
		t.Fatalf("Exchange = %q, %v", token, err)
	}
}

func TestErrorsNeverContainSecrets(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"code liu_code is not valid"}`))
	})
	_, err := c.Exchange(t.Context(), "liu_code", "verifier", "http://x/cb")
	var e *Error
	if !errors.As(err, &e) || e.Status != http.StatusBadRequest || e.Code != "invalid_grant" {
		t.Fatalf("err = %#v", err)
	}
	// The description could echo anything back: it isn't part of the error.
	for _, secret := range []string{"liu_code", "verifier"} {
		if strings.Contains(err.Error(), secret) {
			t.Errorf("error %q contains %q", err, secret)
		}
	}
	_, err = c.Account(t.Context(), "lio_token")
	if err == nil || strings.Contains(err.Error(), "lio_token") {
		t.Errorf("Account error = %v", err)
	}
}

func TestAccountAndRevokeUseTheBearerToken(t *testing.T) {
	var revoked bool
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer lio_token" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /api/account":
			_, _ = w.Write([]byte(`{"id":"thibault","username":"Thibault","perfs":{}}`))
		case "DELETE /api/token":
			revoked = true
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	})
	acct, err := c.Account(t.Context(), "lio_token")
	if err != nil || acct != (Account{ID: "thibault", Username: "Thibault"}) {
		t.Fatalf("Account = %+v, %v", acct, err)
	}
	if err := c.Revoke(t.Context(), "lio_token"); err != nil || !revoked {
		t.Fatalf("Revoke = %v (revoked %v)", err, revoked)
	}
}

func TestAccountIsValidated(t *testing.T) {
	for _, body := range []string{
		`{"username":"NoID"}`,
		`{"id":"thibault"}`,
		`{"id":"../admin","username":"../admin"}`,
		`{"id":"thibault","username":"Someone"}`, // the id is the lower-cased username
		`{"id":"a","username":"a"}`,
		`{"id":"<script>","username":"<script>"}`,
	} {
		c := newClient(t, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(body))
		})
		if acct, err := c.Account(t.Context(), "lio_token"); err == nil {
			t.Errorf("%s was accepted as %+v", body, acct)
		}
	}
}
