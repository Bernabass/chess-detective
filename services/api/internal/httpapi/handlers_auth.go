package httpapi

import (
	"context"
	"strings"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
)

// GetMe reports the caller. Without a session they're a guest with empty stats.
func (s *Server) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	id := playerID(ctx)
	if id == 0 {
		return GetMe200JSONResponse{Guest: true, Stats: toStats(daily.PlayerStats{})}, nil
	}
	me, err := s.me(ctx, id)
	return GetMe200JSONResponse(me), err
}

func (s *Server) me(ctx context.Context, id int64) (Me, error) {
	acct, err := s.auth.AccountOf(ctx, id)
	if err != nil {
		return Me{}, err //nolint:wrapcheck // already wrapped
	}
	st, err := daily.StatsFor(ctx, s.daily.Store.Queries(), id, s.clock.Now())
	if err != nil {
		return Me{}, err //nolint:wrapcheck // already wrapped
	}
	me := Me{Guest: acct.Guest, Stats: toStats(st)}
	if !acct.Guest {
		me.Username = &acct.Username
	}
	return me, nil
}

// authLimits applies the login/register limits per IP and per (case-insensitive) username.
func (s *Server) authLimits(ctx context.Context, username string) error {
	if err := limit(s.limits.AuthPerIP, stateOf(ctx).ip.String()); err != nil {
		return err
	}
	return limit(s.limits.AuthPerUsername, strings.ToLower(username))
}

// Register creates an account; the caller's guest attempts move to it and the session rotates.
func (s *Server) Register(ctx context.Context, req RegisterRequestObject) (RegisterResponseObject, error) {
	if err := s.authLimits(ctx, req.Body.Username); err != nil {
		return nil, err
	}
	acct, sess, err := s.auth.Register(ctx, stateOf(ctx).session, req.Body.Username, req.Body.Password)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	s.adopt(ctx, sess)
	me, err := s.me(ctx, acct.PlayerID)
	return Register201JSONResponse(me), err
}

// Login signs in, with the same merge and rotation.
func (s *Server) Login(ctx context.Context, req LoginRequestObject) (LoginResponseObject, error) {
	if err := s.authLimits(ctx, req.Body.Username); err != nil {
		return nil, err
	}
	acct, sess, err := s.auth.Login(ctx, stateOf(ctx).session, req.Body.Username, req.Body.Password)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	s.adopt(ctx, sess)
	me, err := s.me(ctx, acct.PlayerID)
	return Login200JSONResponse(me), err
}

// Logout deletes the session and clears the cookie.
func (s *Server) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	st := stateOf(ctx)
	if err := s.auth.Logout(ctx, st.session); err != nil {
		return nil, err //nolint:wrapcheck // already wrapped
	}
	if st.w != nil {
		s.clearSessionCookie(st.w)
	}
	st.session = nil
	return Logout204Response{}, nil
}

// toStats converts stats for the API.
func toStats(st daily.PlayerStats) Stats {
	out := Stats{
		Played:            st.Played,
		Solved:            st.Solved,
		CurrentStreak:     st.CurrentStreak,
		MaxStreak:         st.MaxStreak,
		GuessDistribution: st.GuessDist[:],
	}
	if st.Played > 0 {
		out.WinRate = float32(st.Solved) / float32(st.Played)
		out.AverageHints = float32(st.HintsTotal) / float32(st.Played)
	}
	return out
}

// ensureSession returns the caller's session, creating a guest and its cookie if needed.
func (s *Server) ensureSession(ctx context.Context) (auth.Session, error) {
	if sess := stateOf(ctx).session; sess != nil {
		return *sess, nil
	}
	sess, err := s.auth.NewGuest(ctx)
	if err != nil {
		return auth.Session{}, err //nolint:wrapcheck // already wrapped
	}
	s.adopt(ctx, sess)
	return sess, nil
}
