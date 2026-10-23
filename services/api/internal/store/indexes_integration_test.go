//go:build integration

package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
)

// The hot and periodic queries can use their indexes (SPEC §10.3). With sequential scans
// disabled, the planner picks an index whenever one applies, so the plan shows whether it does.
func TestQueriesUseIndexes(t *testing.T) {
	t.Parallel()
	_, db := dbtest.Store(t)
	ctx := t.Context()

	cases := []struct{ query, index string }{
		{"SELECT * FROM players p WHERE p.user_id IS NULL AND p.created_at < now()", "players_guests_created_at"},
		{"SELECT * FROM sessions WHERE expires_at <= now()", "sessions_expires_at"},
		{"SELECT * FROM sessions WHERE player_id = 1", "sessions_player_id"},
		{"SELECT min(id) FROM puzzles WHERE difficulty = 3", "puzzles_difficulty_id"},
		{"SELECT * FROM attempts WHERE puzzle_id = 1 AND status = 'solved' AND NOT is_archive", "attempts_leaderboard"},
		{"SELECT * FROM attempts WHERE player_id = 1 AND puzzle_id = 1", "attempts_player_id_puzzle_id_key"},
		{"SELECT * FROM guesses WHERE attempt_id = 1", "guesses_pkey"},
		{"SELECT * FROM daily_schedule WHERE number = 3", "daily_schedule_number_key"},
		{"SELECT * FROM oauth_states WHERE expires_at <= now()", "oauth_states_expires_at"},
	}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
			return err
		}
		for _, c := range cases {
			plan := explain(ctx, t, tx, c.query)
			if !strings.Contains(plan, c.index) {
				t.Errorf("%s\ndoesn't use %s:\n%s", c.query, c.index, plan)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func explain(ctx context.Context, t *testing.T, tx pgx.Tx, query string) string {
	t.Helper()
	rows, err := tx.Query(ctx, "EXPLAIN "+query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(lines, "\n")
}
