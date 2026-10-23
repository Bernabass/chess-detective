package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

// CleanupReport is what one cleanup deleted.
type CleanupReport struct {
	Sessions, Guests, OAuthStates int64
}

// Cleanup deletes expired sessions and OAuth states, and guest players older than
// GuestRetention that never made a guess (their attempts, sessions and stats cascade). Bots
// that only read the daily create nothing; this bounds what clients that start puzzles and
// leave can accumulate (DECISIONS 2026-10-23).
func Cleanup(ctx context.Context, st *store.Store, now time.Time) (CleanupReport, error) {
	q := st.Queries()
	var r CleanupReport
	var err error
	if r.Sessions, err = q.DeleteExpiredSessions(ctx, now); err != nil {
		return r, fmt.Errorf("deleting expired sessions: %w", err)
	}
	if r.Guests, err = q.DeleteIdleGuests(ctx, now.Add(-GuestRetention)); err != nil {
		return r, fmt.Errorf("deleting idle guests: %w", err)
	}
	if r.OAuthStates, err = q.DeleteExpiredOAuthStates(ctx, now); err != nil {
		return r, fmt.Errorf("deleting expired OAuth states: %w", err)
	}
	return r, nil
}
