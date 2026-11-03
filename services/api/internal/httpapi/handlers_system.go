package httpapi

import (
	"context"
	"fmt"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
)

// MinScheduledDays is how many days of scheduled puzzles should always remain; fewer is
// logged as a warning by the cleanup job and at startup.
const MinScheduledDays = 30

// RunCleanup is the daily cleanup job, called by the platform's cron (ARCHITECTURE.md §10.3).
// The validator has already checked the cron secret.
func (s *Server) RunCleanup(ctx context.Context, _ RunCleanupRequestObject) (RunCleanupResponseObject, error) {
	now := s.clock.Now()
	r, err := auth.Cleanup(ctx, s.auth.Store, now)
	if err != nil {
		return nil, fmt.Errorf("cleanup: %w", err)
	}
	days, err := daily.ScheduledDays(ctx, s.auth.Store, clock.Day(now))
	if err != nil {
		return nil, err //nolint:wrapcheck // already wrapped
	}
	s.logger.InfoContext(ctx, "cleanup", "sessions", r.Sessions, "guests", r.Guests, "oauth_states", r.OAuthStates, "days_scheduled", days)
	if days < MinScheduledDays {
		s.logger.WarnContext(ctx, "few puzzles left on the schedule: run retrograde schedule", "days_scheduled", days)
	}
	return RunCleanup200JSONResponse{Sessions: r.Sessions, Guests: r.Guests, OauthStates: r.OAuthStates, DaysScheduled: days}, nil
}
