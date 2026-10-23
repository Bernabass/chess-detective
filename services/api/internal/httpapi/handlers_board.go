package httpapi

import (
	"context"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/leaderboard"
)

// GetDailyLeaderboard returns a puzzle's leaderboard and the caller's own entry.
func (s *Server) GetDailyLeaderboard(ctx context.Context, req GetDailyLeaderboardRequestObject) (GetDailyLeaderboardResponseObject, error) {
	limit := 100
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	entries, mine, err := s.board.Daily(ctx, req.Number, limit, playerID(ctx))
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	out := DailyLeaderboard{Number: req.Number, Entries: make([]DailyEntry, len(entries))}
	for i, e := range entries {
		out.Entries[i] = toDailyEntry(e)
	}
	if mine != nil {
		you := toDailyEntry(*mine)
		out.You = &you
	}
	return GetDailyLeaderboard200JSONResponse(out), nil
}

func toDailyEntry(e leaderboard.DailyEntry) DailyEntry {
	return DailyEntry{Rank: e.Rank, Username: e.Username, Guesses: e.Guesses, Hints: e.Hints, Seconds: e.Seconds}
}

// GetAllTimeLeaderboard returns the top 100 by a metric.
func (s *Server) GetAllTimeLeaderboard(ctx context.Context, req GetAllTimeLeaderboardRequestObject) (GetAllTimeLeaderboardResponseObject, error) {
	entries, err := s.board.AllTime(ctx, string(req.Params.Metric))
	if err != nil {
		return nil, err //nolint:wrapcheck // already wrapped
	}
	out := AllTimeLeaderboard{Metric: AllTimeLeaderboardMetric(req.Params.Metric), Entries: make([]AllTimeEntry, len(entries))}
	for i, e := range entries {
		out.Entries[i] = AllTimeEntry{Rank: e.Rank, Username: e.Username, Value: e.Value}
	}
	return GetAllTimeLeaderboard200JSONResponse(out), nil
}

// GetUser returns a public profile.
func (s *Server) GetUser(ctx context.Context, req GetUserRequestObject) (GetUserResponseObject, error) {
	p, err := s.board.Profile(ctx, req.Username)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	return GetUser200JSONResponse(Profile{Username: p.Username, Joined: p.Joined, Stats: toStats(p.Stats)}), nil
}

// GetArchive lists past puzzles, newest first, with the caller's results.
func (s *Server) GetArchive(ctx context.Context, req GetArchiveRequestObject) (GetArchiveResponseObject, error) {
	page := 1
	if req.Params.Page != nil {
		page = *req.Params.Page
	}
	items, total, err := s.daily.Archive(ctx, page, playerID(ctx))
	if err != nil {
		return nil, err //nolint:wrapcheck // already wrapped
	}
	out := Archive{Page: page, PageSize: daily.ArchivePageSize, Total: total, Puzzles: make([]ArchiveItem, len(items))}
	for i, it := range items {
		out.Puzzles[i] = ArchiveItem{Number: it.Number, Day: openapi_types.Date{Time: it.Day}, Difficulty: it.Difficulty, Plies: it.Plies}
		if it.Result != nil {
			out.Puzzles[i].Result = &ArchiveResult{Status: AttemptStatus(it.Result.Status), Guesses: it.Result.Guesses, HintsUsed: it.Result.Hints}
		}
	}
	return GetArchive200JSONResponse(out), nil
}
