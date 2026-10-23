// Package leaderboard reads the daily and all-time leaderboards (SPEC §8.5, §10.7) and public
// profiles. Guests never appear.
package leaderboard

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// Metrics of the all-time leaderboard.
const (
	CurrentStreak = "current_streak"
	MaxStreak     = "max_streak"
	Solved        = "solved"
)

// ErrUserNotFound is a profile that doesn't exist.
var ErrUserNotFound = errors.New("no such user")

// DailyEntry is one row of a daily leaderboard.
type DailyEntry struct {
	Rank     int
	Username string
	Guesses  int
	Hints    int
	Seconds  int
}

// Entry is one row of the all-time leaderboard.
type Entry struct {
	Rank     int
	Username string
	Value    int
}

// Profile is a public profile.
type Profile struct {
	Username string
	Joined   time.Time
	Stats    daily.PlayerStats
}

// Service reads leaderboards.
type Service struct {
	Store   *store.Store
	Clock   clock.Clock
	Puzzles *daily.Service
}

// Daily is puzzle `number`'s leaderboard (top `limit`), plus the player's own entry if they
// are on it (playerID 0: nobody).
func (s *Service) Daily(ctx context.Context, number, limit int, playerID int64) ([]DailyEntry, *DailyEntry, error) {
	p, err := s.Puzzles.Get(ctx, number, 0)
	if err != nil {
		return nil, nil, err //nolint:wrapcheck // domain error
	}
	q := s.Store.Queries()
	row, err := q.GetDailyByNumber(ctx, int32(p.Number)) //nolint:gosec // bounded by the contract
	if err != nil {
		return nil, nil, fmt.Errorf("loading puzzle: %w", err)
	}
	rows, err := q.DailyLeaderboard(ctx, sqlcdb.DailyLeaderboardParams{PuzzleID: row.PuzzleID, RowLimit: int32(limit)}) //nolint:gosec // 1..100
	if err != nil {
		return nil, nil, fmt.Errorf("loading leaderboard: %w", err)
	}
	entries := make([]DailyEntry, len(rows))
	for i, r := range rows {
		entries[i] = DailyEntry{Rank: int(r.Rank), Username: r.Username, Guesses: int(r.Guesses), Hints: int(r.Hints), Seconds: int(r.Seconds)}
	}
	if playerID == 0 {
		return entries, nil, nil
	}
	mine, err := q.DailyLeaderboardEntry(ctx, sqlcdb.DailyLeaderboardEntryParams{PuzzleID: row.PuzzleID, PlayerID: playerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return entries, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("loading own entry: %w", err)
	}
	return entries, &DailyEntry{Rank: int(mine.Rank), Username: mine.Username, Guesses: int(mine.Guesses), Hints: int(mine.Hints), Seconds: int(mine.Seconds)}, nil
}

// AllTime is the top 100 by a metric.
func (s *Service) AllTime(ctx context.Context, metric string) ([]Entry, error) {
	yesterday := clock.Day(s.Clock.Now()).AddDate(0, 0, -1)
	rows, err := s.Store.Queries().AllTimeLeaderboard(ctx, sqlcdb.AllTimeLeaderboardParams{Metric: metric, Yesterday: yesterday})
	if err != nil {
		return nil, fmt.Errorf("loading leaderboard: %w", err)
	}
	out := make([]Entry, len(rows))
	for i, r := range rows {
		out[i] = Entry{Rank: int(r.Rank), Username: r.Username, Value: int(r.Value)}
	}
	return out, nil
}

// Profile is a user's public profile.
func (s *Service) Profile(ctx context.Context, username string) (Profile, error) {
	q := s.Store.Queries()
	row, err := q.GetProfile(ctx, username)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrUserNotFound
	}
	if err != nil {
		return Profile{}, fmt.Errorf("loading profile: %w", err)
	}
	st, err := daily.StatsFor(ctx, q, row.PlayerID, s.Clock.Now())
	if err != nil {
		return Profile{}, err //nolint:wrapcheck // already wrapped
	}
	return Profile{Username: row.Username, Joined: row.CreatedAt, Stats: st}, nil
}
