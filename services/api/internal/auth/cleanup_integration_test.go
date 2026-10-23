//go:build integration

package auth_test

import (
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
)

func TestCleanup(t *testing.T) {
	t.Parallel()
	st, db := dbtest.Store(t)
	ctx := t.Context()
	now := time.Date(2026, 12, 1, 12, 0, 0, 0, time.UTC)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	day := 24 * time.Hour

	// Players: 1 a 29-day-old guest, 2 a 31-day-old guest, 3 a 31-day-old guest who made a
	// guess, 4 a 31-day-old guest who started a puzzle without guessing, 5 a 31-day-old account.
	exec(`INSERT INTO users (id, username, created_at) VALUES (1, 'old_user', $1)`, now.Add(-31*day))
	exec(`INSERT INTO players (id, user_id, created_at) VALUES
		(1, NULL, $1), (2, NULL, $2), (3, NULL, $2), (4, NULL, $2), (5, 1, $2)`, now.Add(-29*day), now.Add(-31*day))
	exec(`INSERT INTO puzzles (id, external_id, plies, target, solution, difficulty, solver_nodes, engine_version)
		VALUES (1, 'p1', 2, 'x w', '{g1f3,g8f6}', 1, 1, 'test')`)
	exec(`INSERT INTO attempts (id, player_id, puzzle_id, is_archive, started_at) VALUES
		(1, 3, 1, false, $1), (2, 4, 1, false, $1)`, now.Add(-31*day))
	exec(`INSERT INTO guesses (attempt_id, idx, moves, feedback) VALUES (1, 0, '{g1f3,g8f6}', 'GG')`)
	// Sessions: one expired a second ago, one expiring in a second (both on player 1).
	exec(`INSERT INTO sessions (token_hash, player_id, expires_at) VALUES
		('\x01', 1, $1), ('\x02', 1, $2)`, now.Add(-time.Second), now.Add(time.Second))
	exec(`INSERT INTO oauth_states (state_hash, code_verifier, return_to, expires_at) VALUES
		('\x01', 'v', '/', $1), ('\x02', 'v', '/', $2)`, now.Add(-time.Second), now.Add(time.Minute))

	r, err := auth.Cleanup(ctx, st, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.Sessions != 1 || r.Guests != 2 || r.OAuthStates != 1 {
		t.Fatalf("report = %+v, want 1 session, 2 guests, 1 OAuth state", r)
	}
	var players []int64
	rows, err := db.Query(ctx, "SELECT id FROM players ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		players = append(players, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if want := []int64{1, 3, 5}; len(players) != 3 || players[0] != 1 || players[1] != 3 || players[2] != 5 {
		t.Fatalf("players left = %v, want %v", players, want)
	}
	var attempts int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM attempts").Scan(&attempts); err != nil || attempts != 1 {
		t.Fatalf("%d attempts left (%v), want 1 (the idle guest's went with it)", attempts, err)
	}

	// A second run finds nothing more.
	if r, err := auth.Cleanup(ctx, st, now); err != nil || r != (auth.CleanupReport{}) {
		t.Fatalf("second run = %+v, %v", r, err)
	}
}
