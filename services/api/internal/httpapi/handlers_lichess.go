package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
)

// oauthCookie binds a Lichess sign-in to the browser that started it (against login CSRF: an
// attacker's own callback link can't sign someone else in). Only sent to the callback path.
const (
	oauthCookie     = "rg_oauth"
	oauthCookiePath = "/api/auth/lichess"
)

func redirectStart(location string) LichessStart302Response {
	return LichessStart302Response{Headers: LichessStart302ResponseHeaders{Location: location}}
}

func redirectCallback(location string) LichessCallback302Response {
	return LichessCallback302Response{Headers: LichessCallback302ResponseHeaders{Location: location}}
}

// LichessStart sends the browser to Lichess to approve the sign-in (SPEC §10.6).
func (s *Server) LichessStart(ctx context.Context, req LichessStartRequestObject) (LichessStartResponseObject, error) {
	st := stateOf(ctx)
	if err := limit(s.limits.OAuthStartPerIP, st.ip.String()); err != nil {
		return redirectStart("/login?lichess=busy"), nil
	}
	returnTo := ""
	if req.Params.ReturnTo != nil {
		returnTo = *req.Params.ReturnTo
	}
	location, state, err := s.auth.StartLichess(ctx, st.session, returnTo)
	if err != nil {
		s.logger.ErrorContext(ctx, "starting a Lichess sign-in", "err", err)
		return redirectStart("/login?lichess=failed"), nil
	}
	if st.w != nil {
		//nolint:gosec // Secure is COOKIE_SECURE: false only for http://localhost
		http.SetCookie(st.w, &http.Cookie{
			Name:     oauthCookie,
			Value:    state,
			Path:     oauthCookiePath,
			MaxAge:   int(auth.StateTTL / time.Second),
			HttpOnly: true,
			Secure:   s.cookieSecure,
			// Lax: the cookie comes back on Lichess's top-level redirect to the callback.
			SameSite: http.SameSiteLaxMode,
		})
	}
	return redirectStart(location), nil
}

// LichessCallback finishes the sign-in and sends the browser on (SPEC §10.6). Failures go to
// the sign-in page with a reason; nothing secret is ever logged (codes, states, tokens).
func (s *Server) LichessCallback(ctx context.Context, req LichessCallbackRequestObject) (LichessCallbackResponseObject, error) {
	st := stateOf(ctx)
	if st.w != nil { // the state is single use either way
		//nolint:gosec // Secure is COOKIE_SECURE: false only for http://localhost
		http.SetCookie(st.w, &http.Cookie{
			Name: oauthCookie, Value: "", Path: oauthCookiePath, MaxAge: -1,
			HttpOnly: true, Secure: s.cookieSecure, SameSite: http.SameSiteLaxMode,
		})
	}
	value := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	acct, sess, returnTo, err := s.auth.CompleteLichess(ctx, st.session, auth.LichessCallback{
		Code:        value(req.Params.Code),
		State:       value(req.Params.State),
		Error:       value(req.Params.Error),
		CookieState: st.oauthState,
	})
	if err != nil {
		reason := auth.LichessReason(err)
		level := slog.LevelError // our side: the database, Lichess, a bug
		if auth.LichessUserCaused(err) {
			level = slog.LevelInfo
		}
		s.logger.Log(ctx, level, "lichess sign-in failed", "reason", reason, "err", err)
		return redirectCallback("/login?lichess=" + reason), nil
	}
	s.adopt(ctx, sess)
	s.logger.InfoContext(ctx, "signed in with Lichess", "username", acct.Username)
	return redirectCallback(returnTo), nil
}
