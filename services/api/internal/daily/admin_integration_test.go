//go:build integration

package daily_test

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
)

// The committed v1 pool, so the test also proves the real data imports.
const poolFile = "../../../../data/puzzles-v1.jsonl"

var launch = time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC) // a Monday

func TestImportIsIdempotent(t *testing.T) {
	t.Parallel()
	st, db := dbtest.Store(t)
	raw, err := os.ReadFile(poolFile)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Count(strings.TrimSpace(string(raw)), "\n") + 1

	r, err := daily.ImportPuzzles(t.Context(), st, strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if r.Inserted != lines || r.Skipped != 0 {
		t.Fatalf("first import = %+v, want %d inserted", r, lines)
	}
	r, err = daily.ImportPuzzles(t.Context(), st, strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if r.Inserted != 0 || r.Skipped != lines {
		t.Fatalf("second import = %+v, want %d skipped", r, lines)
	}
	var n int
	if err := db.QueryRow(t.Context(), "SELECT count(*) FROM puzzles").Scan(&n); err != nil || n != lines {
		t.Fatalf("%d puzzles (%v), want %d", n, err, lines)
	}
}

func TestImportRejectsABadSolutionAtomically(t *testing.T) {
	t.Parallel()
	st, db := dbtest.Store(t)
	good := `{"id":"ok-1","plies":2,"target":"rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w","solution":["g1f3","g8f6"],"features":[],"difficulty":1,"score":1,"solverNodes":1,"engineVersion":"0.4.0","seed":1}`
	cases := map[string]string{
		"wrong target": `{"id":"bad-1","plies":2,"target":"8/8/8/8/8/8/8/8 w","solution":["g1f3","g8f6"],"difficulty":1,"solverNodes":1,"engineVersion":"0.4.0"}`,
		"illegal move": `{"id":"bad-2","plies":2,"target":"x w","solution":["g1f3","g8g6"],"difficulty":1,"solverNodes":1,"engineVersion":"0.4.0"}`,
		"plies differ": `{"id":"bad-3","plies":3,"target":"x w","solution":["g1f3","g8f6"],"difficulty":1,"solverNodes":1,"engineVersion":"0.4.0"}`,
		"difficulty 6": `{"id":"bad-4","plies":2,"target":"x w","solution":["g1f3","g8f6"],"difficulty":6,"solverNodes":1,"engineVersion":"0.4.0"}`,
		"not JSON":     `{"id":`,
	}
	for name, bad := range cases {
		_, err := daily.ImportPuzzles(t.Context(), st, strings.NewReader(good+"\n"+bad+"\n"))
		if err == nil || !strings.Contains(err.Error(), "line 2") {
			t.Errorf("%s: err = %v, want an error naming line 2", name, err)
		}
	}
	var n int
	if err := db.QueryRow(t.Context(), "SELECT count(*) FROM puzzles").Scan(&n); err != nil || n != 0 {
		t.Fatalf("%d puzzles imported from bad files (%v)", n, err)
	}
}

func TestSchedule(t *testing.T) {
	t.Parallel()
	st, db := dbtest.Store(t)
	f, err := os.Open(poolFile)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if _, err := daily.ImportPuzzles(t.Context(), st, f); err != nil {
		t.Fatal(err)
	}
	before, err := daily.RemainingPool(t.Context(), st)
	if err != nil {
		t.Fatal(err)
	}

	// Before launch: nothing.
	if _, err := daily.Schedule(t.Context(), st, launch, launch.AddDate(0, 0, -1), 7); err == nil {
		t.Fatal("scheduled a day before LAUNCH_DATE")
	}

	r, err := daily.Schedule(t.Context(), st, launch, launch, 14)
	if err != nil {
		t.Fatal(err)
	}
	if r.Assigned != 14 || r.Kept != 0 {
		t.Fatalf("report = %+v", r)
	}
	// Each day gets the lowest unscheduled id of its weekday's level, numbered from launch.
	rows, err := db.Query(t.Context(), `
		SELECT s.day, s.number, p.difficulty,
		       p.id = (SELECT min(q.id) FROM puzzles q WHERE q.difficulty = p.difficulty
		               AND q.id NOT IN (SELECT puzzle_id FROM daily_schedule s2 WHERE s2.day < s.day))
		FROM daily_schedule s JOIN puzzles p ON p.id = s.puzzle_id ORDER BY s.day`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	i := 0
	for rows.Next() {
		var day time.Time
		var number int
		var difficulty int16
		var lowest bool
		if err := rows.Scan(&day, &number, &difficulty, &lowest); err != nil {
			t.Fatal(err)
		}
		if want := launch.AddDate(0, 0, i); !day.Equal(want) || number != i+1 {
			t.Errorf("row %d: %s #%d, want %s #%d", i, day.Format(time.DateOnly), number, want.Format(time.DateOnly), i+1)
		}
		if int(difficulty) != daily.Ramp(day.Weekday()) || !lowest {
			t.Errorf("%s (%s): difficulty %d, lowest id %v", day.Format(time.DateOnly), day.Weekday(), difficulty, lowest)
		}
		i++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for level := 1; level <= 5; level++ {
		perWeek := 0
		for d := range time.Weekday(7) {
			if daily.Ramp(d) == level {
				perWeek++
			}
		}
		if r.Remaining[level] != before[level]-2*perWeek {
			t.Errorf("level %d: %d left, want %d", level, r.Remaining[level], before[level]-2*perWeek)
		}
	}

	// Rescheduling keeps the days already set.
	r, err = daily.Schedule(t.Context(), st, launch, launch, 21)
	if err != nil || r.Assigned != 7 || r.Kept != 14 {
		t.Fatalf("second schedule = %+v, %v", r, err)
	}

	// Running out of a level schedules nothing, and still reports the pool.
	left := r.Remaining
	from := launch.AddDate(0, 0, 21) // a Monday
	r, err = daily.Schedule(t.Context(), st, launch, from, 7*(left[5]+1))
	if !errors.Is(err, daily.ErrPoolExhausted) {
		t.Fatalf("err = %v, want ErrPoolExhausted", err)
	}
	if r.Remaining != left {
		t.Fatalf("remaining after a failed schedule = %v, want %v", r.Remaining, left)
	}
	var days int
	if err := db.QueryRow(t.Context(), "SELECT count(*) FROM daily_schedule").Scan(&days); err != nil || days != 21 {
		t.Fatalf("%d days scheduled after a failed run (%v), want 21", days, err)
	}
}
