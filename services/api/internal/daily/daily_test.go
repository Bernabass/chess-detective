package daily_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/chessrules"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
)

func TestFeedbackMatchesTheVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "fixtures", "feedback-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Vectors []struct {
			Comment  string   `json:"comment"`
			Solution []string `json:"solution"`
			Guess    []string `json:"guess"`
			Feedback string   `json:"feedback"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Vectors) < 13 {
		t.Fatalf("want at least 13 vectors (SPEC §8.3), got %d", len(file.Vectors))
	}
	for _, v := range file.Vectors {
		if got := daily.Feedback(v.Solution, v.Guess); got != v.Feedback {
			t.Errorf("%s: Feedback = %q, want %q", v.Comment, got, v.Feedback)
		}
	}
}

func replay(t *testing.T, moves ...string) chessrules.Result {
	t.Helper()
	r, err := chessrules.Replay(moves)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestHints(t *testing.T) {
	// 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 4.Bc4 Nf6 5.Nf3 Bf5 6.O-O
	sol := replay(t, "e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5", "f1c4", "g8f6", "g1f3", "c8f5", "e1g1")

	movers := daily.MoversHint(sol)
	if !reflect.DeepEqual(movers.White, []string{"king", "rook", "bishop", "knight", "pawn"}) {
		t.Errorf("white movers = %v (castling moves the rook too)", movers.White)
	}
	if !reflect.DeepEqual(movers.Black, []string{"queen", "bishop", "knight", "pawn"}) {
		t.Errorf("black movers = %v", movers.Black)
	}
	if movers.Text != "White moved: king, rook, bishop, knight, pawn. Black moved: queen, bishop, knight, pawn." {
		t.Errorf("movers text = %q", movers.Text)
	}

	captures := daily.CapturesHint(sol)
	if !reflect.DeepEqual(captures.Plies, []int{3, 4}) || captures.Text != "2 captures, on plies 3 and 4." {
		t.Errorf("captures = %+v", captures)
	}
	if c := daily.CapturesHint(replay(t, "g1f3", "g8f6")); c.Text != "No captures." || len(c.Plies) != 0 {
		t.Errorf("no captures = %+v", c)
	}
	if c := daily.CapturesHint(replay(t, "e2e4", "d7d5", "e4d5")); c.Text != "One capture, on ply 3." {
		t.Errorf("one capture = %+v", c)
	}

	// Hint 3: the first non-green ply of the latest guess, or ply 1 before any guess.
	if daily.MovePly("") != 1 || daily.MovePly("GGYX") != 3 || daily.MovePly("XGGG") != 1 {
		t.Error("MovePly")
	}
	move := daily.MoveHint(sol, 11)
	if move.UCI != "e1g1" || move.SAN != "O-O" || move.Text != "Ply 11 (White): O-O." {
		t.Errorf("move hint = %+v", move)
	}
	if m := daily.MoveHint(sol, 4); m.Text != "Ply 4 (Black): Qxd5." {
		t.Errorf("black move hint = %+v", m)
	}

	if got := daily.Hints(sol, 3, 5); len(got) != 3 || got[2].Ply != 5 {
		t.Errorf("Hints(3, 5) = %+v", got)
	}
	if got := daily.Hints(sol, 0, 0); len(got) != 0 {
		t.Errorf("Hints(0) = %+v", got)
	}
}

func day(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func TestComputeStatsAndStreaks(t *testing.T) {
	attempts := []daily.FinishedAttempt{
		{Day: day("2026-11-01"), Solved: true, Guesses: 2, Hints: 1},
		{Day: day("2026-11-02"), Solved: true, Guesses: 3},
		{Day: day("2026-11-03"), Solved: true, Guesses: 1},
		{Day: day("2026-11-04"), Solved: false, Guesses: 6, Hints: 3}, // breaks the streak
		{Day: day("2026-11-06"), Solved: true, Guesses: 6},
		{Day: day("2026-11-07"), Solved: true, Guesses: 2},
	}
	s := daily.ComputeStats(attempts)
	if s.Played != 6 || s.Solved != 5 || s.HintsTotal != 4 {
		t.Errorf("played/solved/hints = %d/%d/%d", s.Played, s.Solved, s.HintsTotal)
	}
	if s.MaxStreak != 3 || s.CurrentStreak != 2 {
		t.Errorf("streaks = max %d current %d, want 3 and 2", s.MaxStreak, s.CurrentStreak)
	}
	if s.GuessDist != [7]int{1, 2, 1, 0, 0, 1, 1} {
		t.Errorf("guess distribution = %v", s.GuessDist)
	}
	if s.LastSolvedDay == nil || !s.LastSolvedDay.Equal(day("2026-11-07")) {
		t.Errorf("last solved day = %v", s.LastSolvedDay)
	}

	// The streak is current today and tomorrow (today's puzzle may still be ahead), then gone.
	last := day("2026-11-07")
	for today, want := range map[string]int{"2026-11-07": 2, "2026-11-08": 2, "2026-11-09": 0} {
		if got := daily.CurrentStreakOn(s.CurrentStreak, &last, day(today)); got != want {
			t.Errorf("CurrentStreakOn(%s) = %d, want %d", today, got, want)
		}
	}
	if daily.CurrentStreakOn(5, nil, day("2026-11-07")) != 0 {
		t.Error("no solve, no streak")
	}
	if empty := daily.ComputeStats(nil); empty.Played != 0 || empty.LastSolvedDay != nil || empty.CurrentStreak != 0 {
		t.Errorf("empty stats = %+v", empty)
	}

	// A failure after the last solve ends the current streak at once (SPEC §8.5); the max stays.
	failed := daily.ComputeStats(append(attempts, daily.FinishedAttempt{Day: day("2026-11-08"), Guesses: 6}))
	if failed.CurrentStreak != 0 || failed.MaxStreak != 3 || !failed.LastSolvedDay.Equal(day("2026-11-07")) {
		t.Errorf("after a failure: current %d, max %d, last solved %v", failed.CurrentStreak, failed.MaxStreak, failed.LastSolvedDay)
	}
}
