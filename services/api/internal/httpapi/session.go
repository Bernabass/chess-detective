package httpapi

import (
	"context"
	"net/http"
	"net/netip"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
)

// requestState is what the middleware learns about a request, for the handlers: the session,
// the client IP, and the writer (so a handler can set the session cookie before the
// strict server writes the response).
type requestState struct {
	w       http.ResponseWriter
	session *auth.Session
	ip      netip.Addr
}

const stateKey ctxKey = iota + 100

func stateOf(ctx context.Context) *requestState {
	st, _ := ctx.Value(stateKey).(*requestState)
	if st == nil {
		return &requestState{}
	}
	return st
}

// withSession resolves the session cookie (an unknown or expired one is ignored) and extends
// the cookie when the sliding expiry moved. It never creates a session: only
// POST /daily/{number}/start, register and login do.
func (s *Server) withSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st := &requestState{w: w, ip: clientIP(r, s.trustedProxies)}
		if c, err := r.Cookie(auth.CookieName); err == nil && s.auth != nil {
			sess, refreshed, ok, err := s.auth.Resolve(r.Context(), c.Value)
			switch {
			case err != nil:
				s.logger.ErrorContext(r.Context(), "resolving session", "err", err)
				writeProblem(w, http.StatusInternalServerError, "")
				return
			case ok:
				st.session = &sess
				if refreshed {
					s.setSessionCookie(w, c.Value, sess.Expires)
				}
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), stateKey, st)))
	})
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // Secure is COOKIE_SECURE: false only for http://localhost
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(expires.Sub(s.clock.Now()).Seconds()),
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // Secure is COOKIE_SECURE: false only for http://localhost
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// adopt makes sess the request's session and sends its cookie.
func (s *Server) adopt(ctx context.Context, sess auth.Session) {
	st := stateOf(ctx)
	st.session = &sess
	if st.w != nil {
		s.setSessionCookie(st.w, sess.Token, sess.Expires)
	}
}

// playerID is the caller's player, or 0 without a session.
func playerID(ctx context.Context) int64 {
	if sess := stateOf(ctx).session; sess != nil {
		return sess.PlayerID
	}
	return 0
}
