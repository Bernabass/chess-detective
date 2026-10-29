// Package lichess is the client side of "Sign in with Lichess": OAuth 2.0 authorization code
// with PKCE, no client secret (SPEC §10.6). Every detail was checked against the Lichess API
// spec (lichess-org/api, doc/specs/tags/oauth) and lichess-org/api-demo (DECISIONS 2026-10-29).
//
// Tokens, codes and verifiers are secrets: no error from this package ever contains one.
package lichess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var validName = regexp.MustCompile(`^[A-Za-z0-9_-]{2,30}$`)

// Client talks to a Lichess server (lichess.org, or a fake one in tests).
type Client struct {
	BaseURL  *url.URL
	ClientID string
	// HTTP makes the requests; it must have a timeout (serve uses 10 seconds).
	HTTP *http.Client
}

// Account is who signed in. ID is Lichess's stable, lower-case user id; Username is how the
// user writes their name (Lichess only allows changing its case).
type Account struct {
	ID       string
	Username string
}

// Error is a failed Lichess call: which one, the HTTP status, and the OAuth error code if any.
type Error struct {
	Op     string
	Status int
	Code   string
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("lichess %s: %d %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("lichess %s: %d", e.Op, e.Status)
}

// NewSecret returns 32 random bytes in base64url: 43 characters, the minimum Lichess accepts
// for a code_verifier. Used for both the verifier and the state.
func NewSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("reading randomness: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Challenge is the PKCE S256 code challenge: BASE64URL(SHA256(verifier)).
func Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (c *Client) endpoint(path string) string {
	return strings.TrimSuffix(c.BaseURL.String(), "/") + path
}

// AuthorizeURL is where the browser goes to approve the sign-in. No scope: reading who the
// user is (GET /api/account) needs none, and the consent page then says "only public data".
func (c *Client) AuthorizeURL(redirectURI, state, challenge string) string {
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {c.ClientID},
		"redirect_uri":          {redirectURI},
		"code_challenge_method": {"S256"},
		"code_challenge":        {challenge},
		"state":                 {state},
	}
	return c.endpoint("/oauth") + "?" + q.Encode()
}

// Exchange trades an authorization code for an access token (POST /api/token, form-encoded).
func (c *Client) Exchange(ctx context.Context, code, verifier, redirectURI string) (string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
		"client_id":     {c.ClientID},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/api/token"), strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("lichess token: building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := c.do(req, "token", &body); err != nil {
		return "", err
	}
	if body.AccessToken == "" {
		return "", &Error{Op: "token", Status: http.StatusOK, Code: "no access_token"}
	}
	return body.AccessToken, nil
}

// Account reads who the token belongs to (GET /api/account).
func (c *Client) Account(ctx context.Context, token string) (Account, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("/api/account"), nil)
	if err != nil {
		return Account{}, fmt.Errorf("lichess account: building request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	var body struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	if err := c.do(req, "account", &body); err != nil {
		return Account{}, err
	}
	// Lichess usernames are 2-30 of [A-Za-z0-9_-], and the id is the username in lower case.
	// Anything else is refused before it reaches a username or a URL.
	if !validName.MatchString(body.Username) || body.ID != strings.ToLower(body.Username) {
		return Account{}, &Error{Op: "account", Status: http.StatusOK, Code: "unexpected id or username"}
	}
	return Account{ID: body.ID, Username: body.Username}, nil
}

// Revoke ends the token (DELETE /api/token). We never keep Lichess tokens.
func (c *Client) Revoke(ctx context.Context, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.endpoint("/api/token"), nil)
	if err != nil {
		return fmt.Errorf("lichess revoke: building request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return c.do(req, "revoke", nil)
}

// do sends the request and decodes a JSON body into out (nil: ignore the body). On a non-2xx
// answer it returns an *Error with the OAuth error code only (error_description can echo input).
func (c *Client) do(req *http.Request, op string, out any) error {
	resp, err := c.HTTP.Do(req)
	if err != nil {
		// The URL in a transport error has no secrets (tokens go in headers and bodies).
		return fmt.Errorf("lichess %s: %w", op, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("lichess %s: reading response: %w", op, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var oauthErr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &oauthErr)
		return &Error{Op: op, Status: resp.StatusCode, Code: oauthErr.Error}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return &Error{Op: op, Status: resp.StatusCode, Code: "unreadable response"}
	}
	return nil
}
