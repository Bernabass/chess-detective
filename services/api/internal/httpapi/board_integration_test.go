//go:build integration

package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// player registers a new account and returns its client.
func (a *testAPI) player(username string) *client {
	a.t.Helper()
	c := a.client()
	expectStatus(a.t, c.register(username), http.StatusCreated)
	return c
}

// solve starts a puzzle, makes `wrong` wrong guesses and `hints` hints, waits `took`, and solves it.
func (c *client) solve(number, wrong, hints int, took time.Duration) {
	c.api.t.Helper()
	p := c.api.puzzles[number-1]
	c.start(number)
	for range wrong {
		expectStatus(c.api.t, c.guess(number, wrongGuess(len(p.solution))), http.StatusOK)
	}
	for range hints {
		expectStatus(c.api.t, c.hint(number), http.StatusOK)
	}
	c.api.clock.Advance(took)
	if r := c.guess(number, p.solution).json(c.api.t); r["status"] != "solved" {
		c.api.t.Fatalf("solving #%d: %v", number, r)
	}
}

func entryLine(e any) string {
	m := e.(map[string]any)
	return fmt.Sprintf("%v %v g%v h%v %vs", m["rank"], m["username"], m["guesses"], m["hints"], m["seconds"])
}

func TestDailyLeaderboard(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.player("bravo").solve(3, 0, 0, 30*time.Second)
	api.player("alpha").solve(3, 0, 0, 30*time.Second)
	api.player("charlie").solve(3, 0, 1, 10*time.Second)
	delta := api.player("delta")
	delta.solve(3, 1, 0, 5*time.Second)
	api.player("echo").solve(3, 0, 0, 10*time.Second)
	api.client().solve(3, 0, 0, time.Second) // a guest: never listed
	failed := api.player("foxtrot")
	failed.start(3)
	for range 6 {
		failed.guess(3, wrongGuess(11))
	}

	board := delta.get("/api/leaderboards/daily/3").json(t)
	var got []string
	for _, e := range board["entries"].([]any) {
		got = append(got, entryLine(e))
	}
	// Fewer guesses, then fewer hints, then less time; ties share a rank, listed by name.
	want := []string{
		"1 echo g1 h0 10s",
		"2 alpha g1 h0 30s",
		"2 bravo g1 h0 30s",
		"4 charlie g1 h1 10s",
		"5 delta g2 h0 5s",
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("entries:\n got %v\nwant %v", got, want)
	}
	if you := entryLine(board["you"]); you != "5 delta g2 h0 5s" {
		t.Fatalf("you = %s", you)
	}
	if _, ok := failed.get("/api/leaderboards/daily/3").json(t)["you"]; ok {
		t.Fatal("a failed attempt has a rank")
	}
	if n := len(api.client().get("/api/leaderboards/daily/3?limit=2").json(t)["entries"].([]any)); n != 2 {
		t.Fatalf("limit=2 gave %d entries", n)
	}
	expectProblem(t, api.client().get("/api/leaderboards/daily/4"), http.StatusNotFound)
	expectProblem(t, api.client().get("/api/leaderboards/daily/3?limit=0"), http.StatusBadRequest)
}

// Streaks across midnight with the fake clock: a puzzle counts for its own day even if it's
// solved after midnight, and a current streak lapses after a missed day.
func TestStreaksAndAllTime(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	holmes := api.player("holmes")
	watson := api.player("watson")
	api.client().solve(3, 0, 0, 0) // a guest: never listed

	// Day 3: Holmes starts at 23:59 and solves after midnight; Watson solves at noon.
	watson.solve(3, 0, 0, 0)
	api.clock.Set(launch.AddDate(0, 0, 2).Add(23*time.Hour + 59*time.Minute))
	holmes.start(3)
	api.clock.Advance(2 * time.Minute) // now day 4, 00:01
	holmes.solve(3, 0, 0, 0)
	if a := holmes.get("/api/daily/3").json(t)["attempt"].(map[string]any); a["archive"] != false {
		t.Fatal("an attempt started on the puzzle's day became an archive attempt")
	}
	holmes.solve(4, 0, 0, 0)
	// An archive solve doesn't extend anything.
	holmes.solve(1, 0, 0, 0)

	stats := holmes.get("/api/auth/me").json(t)["stats"].(map[string]any)
	if stats["played"] != float64(2) || stats["currentStreak"] != float64(2) || stats["maxStreak"] != float64(2) {
		t.Fatalf("holmes on day 4 = %v", stats)
	}
	if fmt.Sprint(stats["guessDistribution"]) != "[2 0 0 0 0 0 0]" {
		t.Fatalf("guess distribution = %v", stats["guessDistribution"])
	}
	board := func(metric string) string {
		var out []string
		for _, e := range api.client().get("/api/leaderboards/all-time?metric=" + metric).json(t)["entries"].([]any) {
			m := e.(map[string]any)
			out = append(out, fmt.Sprintf("%v %v %v", m["rank"], m["username"], m["value"]))
		}
		return fmt.Sprint(out)
	}
	if got := board("current_streak"); got != "[1 holmes 2 2 watson 1]" {
		t.Fatalf("current streaks on day 4 = %s", got)
	}

	// Day 5: Watson's last solve was the day before yesterday, so his streak has lapsed;
	// Holmes's (last solve yesterday) still stands.
	api.clock.Set(launch.AddDate(0, 0, 4).Add(12 * time.Hour))
	if got := board("current_streak"); got != "[1 holmes 2]" {
		t.Fatalf("current streaks on day 5 = %s", got)
	}
	if got := board("max_streak"); got != "[1 holmes 2 2 watson 1]" {
		t.Fatalf("max streaks = %s", got)
	}
	if got := board("solved"); got != "[1 holmes 2 2 watson 1]" {
		t.Fatalf("solved = %s", got)
	}
	if w := watson.get("/api/auth/me").json(t)["stats"].(map[string]any); w["currentStreak"] != float64(0) || w["maxStreak"] != float64(1) {
		t.Fatalf("watson on day 5 = %v", w)
	}
	expectProblem(t, api.client().get("/api/leaderboards/all-time?metric=speed"), http.StatusBadRequest)
}

func TestProfile(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	api.player("Moriarty").solve(3, 1, 2, 0)

	p := api.client().get("/api/users/moriarty").json(t)
	stats := p["stats"].(map[string]any)
	if p["username"] != "Moriarty" || stats["solved"] != float64(1) || stats["averageHints"] != float64(2) || stats["winRate"] != float64(1) {
		t.Fatalf("profile = %v", p)
	}
	expectProblem(t, api.client().get("/api/users/nobody"), http.StatusNotFound)
	expectProblem(t, api.client().get("/api/users/no%20spaces"), http.StatusBadRequest)
}

func TestArchive(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.solve(2, 1, 0, 0)

	a := c.get("/api/archive").json(t)
	if a["total"] != float64(3) || a["page"] != float64(1) || a["pageSize"] != float64(30) {
		t.Fatalf("archive = %v", a)
	}
	var got []string
	for _, item := range a["puzzles"].([]any) {
		m := item.(map[string]any)
		line := fmt.Sprintf("#%v %v", m["number"], m["day"])
		if r, ok := m["result"].(map[string]any); ok {
			line += fmt.Sprintf(" %v in %v", r["status"], r["guesses"])
		}
		got = append(got, line)
	}
	// Newest first, released puzzles only, with the caller's results.
	want := "[#3 2026-11-04 #2 2026-11-03 solved in 2 #1 2026-11-02]"
	if fmt.Sprint(got) != want {
		t.Fatalf("archive puzzles = %v, want %s", got, want)
	}
	if n := len(c.get("/api/archive?page=2").json(t)["puzzles"].([]any)); n != 0 {
		t.Fatalf("page 2 has %d puzzles", n)
	}
	expectProblem(t, c.get("/api/archive?page=0"), http.StatusBadRequest)
}

// A skipped day ends the current streak everywhere it's shown, even without playing again:
// it stands while the last solve was today or yesterday (UTC) and is 0 from the midnight after.
func TestSkippedDayEndsTheStreak(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	irene := api.player("irene")
	api.clock.Set(launch.AddDate(0, 0, 1).Add(12 * time.Hour)) // day of #2
	irene.solve(2, 0, 0, 0)
	api.clock.Set(launch.AddDate(0, 0, 2).Add(12 * time.Hour)) // day of #3
	irene.solve(3, 0, 0, 0)

	current := func() (me, profile any, board string) {
		t.Helper()
		me = irene.get("/api/auth/me").json(t)["stats"].(map[string]any)["currentStreak"]
		profile = api.client().get("/api/users/irene").json(t)["stats"].(map[string]any)["currentStreak"]
		var entries []string
		for _, e := range api.client().get("/api/leaderboards/all-time?metric=current_streak").json(t)["entries"].([]any) {
			m := e.(map[string]any)
			entries = append(entries, fmt.Sprintf("%v %v", m["username"], m["value"]))
		}
		return me, profile, fmt.Sprint(entries)
	}
	for _, c := range []struct {
		at                time.Time
		want              float64
		wantBoard, reason string
	}{
		{launch.AddDate(0, 0, 2).Add(23*time.Hour + 59*time.Minute), 2, "[irene 2]", "the day of the last solve"},
		{launch.AddDate(0, 0, 3), 2, "[irene 2]", "the next day: today's puzzle is still ahead"},
		{launch.AddDate(0, 0, 3).Add(23*time.Hour + 59*time.Minute), 2, "[irene 2]", "the last minute of the next day"},
		{launch.AddDate(0, 0, 4), 0, "[]", "a whole day skipped"},
		{launch.AddDate(0, 0, 30), 0, "[]", "a month later"},
	} {
		api.clock.Set(c.at)
		me, profile, board := current()
		if me != c.want || profile != c.want || board != c.wantBoard {
			t.Errorf("%s (%s): /auth/me %v, profile %v, board %s; want %v, %v, %s",
				c.reason, c.at.Format(time.DateTime), me, profile, board, c.want, c.want, c.wantBoard)
		}
	}
	// The best streak is history, not current: it stays.
	if s := api.client().get("/api/users/irene").json(t)["stats"].(map[string]any); s["maxStreak"] != float64(2) {
		t.Fatalf("max streak after the lapse = %v", s["maxStreak"])
	}
}
