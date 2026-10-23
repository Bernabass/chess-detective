//go:build integration

package httpapi_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestGetCreatesNothing(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()

	for _, path := range []string{"/api/daily", "/api/daily/3", "/api/daily/1", "/api/auth/me", "/api/archive"} {
		r := c.get(path)
		expectStatus(t, r, http.StatusOK)
		if sc := r.header.Values("Set-Cookie"); len(sc) != 0 {
			t.Errorf("GET %s set a cookie: %v", path, sc)
		}
	}
	if n := api.count("SELECT count(*) FROM players"); n != 0 {
		t.Fatalf("GETs created %d players", n)
	}
	if n := api.count("SELECT count(*) FROM sessions"); n != 0 {
		t.Fatalf("GETs created %d sessions", n)
	}

	today := c.get("/api/daily").json(t)
	if today["number"] != float64(3) || today["target"] != api.today().target || today["plies"] != float64(11) {
		t.Fatalf("GET /daily = %v", today)
	}
	if _, ok := today["attempt"]; ok {
		t.Fatal("an attempt without a session")
	}
	expectProblem(t, c.get("/api/daily/4"), http.StatusNotFound) // tomorrow's is not released
	expectProblem(t, c.get("/api/daily/99"), http.StatusNotFound)
	expectProblem(t, c.get("/api/daily/0"), http.StatusBadRequest) // the contract's minimum is 1
}

func TestStart(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()

	r := c.start(3)
	cookie := r.header.Get("Set-Cookie")
	for _, want := range []string{"rg_session=", "HttpOnly", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(cookie, want) {
			t.Errorf("Set-Cookie %q lacks %q", cookie, want)
		}
	}
	first := r.json(t)["attempt"].(map[string]any)
	if first["status"] != "in_progress" || first["archive"] != false || first["hintsUsed"] != float64(0) {
		t.Fatalf("attempt = %v", first)
	}
	if s := first["startedAt"].(string); !strings.HasSuffix(s, "Z") {
		t.Errorf("startedAt %q is not in UTC", s)
	}

	// Idempotent: the same attempt and started_at, no second player or session.
	api.clock.Advance(5 * time.Minute)
	again := c.start(3)
	if again.header.Get("Set-Cookie") != "" {
		t.Error("a second start set a new cookie")
	}
	if got := again.json(t)["attempt"].(map[string]any)["startedAt"]; got != first["startedAt"] {
		t.Fatalf("startedAt moved from %v to %v", first["startedAt"], got)
	}
	if n := api.count("SELECT count(*) FROM players"); n != 1 {
		t.Fatalf("%d players, want 1", n)
	}
	if n := api.count("SELECT count(*) FROM attempts"); n != 1 {
		t.Fatalf("%d attempts, want 1", n)
	}

	// GET now shows the attempt.
	if _, ok := c.get("/api/daily").json(t)["attempt"]; !ok {
		t.Fatal("GET /daily doesn't show the started attempt")
	}

	// An earlier puzzle is an archive attempt; an unreleased one can't be started (and creates nobody).
	if c.start(1).json(t)["attempt"].(map[string]any)["archive"] != true {
		t.Fatal("puzzle #1 started today is not an archive attempt")
	}
	stranger := api.client()
	expectProblem(t, stranger.post("/api/daily/4/start", map[string]any{}), http.StatusNotFound)
	if n := api.count("SELECT count(*) FROM players"); n != 1 {
		t.Fatalf("starting an unreleased puzzle created a player (%d players)", n)
	}
}

func TestGuessFlow(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	p := api.today()

	// Without a session, and before starting.
	expectProblem(t, c.guess(3, p.solution), http.StatusConflict)
	c.start(1)
	expectProblem(t, c.guess(3, p.solution), http.StatusConflict)
	c.start(3)

	// Contract and rule violations don't use a guess.
	expectProblem(t, c.guess(3, wrongGuess(41)), http.StatusBadRequest)
	expectProblem(t, c.post("/api/daily/3/guesses", map[string]any{"moves": p.solution, "extra": 1}), http.StatusBadRequest)
	if pr := expectProblem(t, c.guess(3, wrongGuess(10)), http.StatusUnprocessableEntity); pr["ply"] != nil {
		t.Errorf("a wrong-length guess names ply %v", pr["ply"])
	}
	illegal := slices.Clone(p.solution)
	illegal[4] = "b1b3"
	if pr := expectProblem(t, c.guess(3, illegal), http.StatusUnprocessableEntity); pr["ply"] != float64(5) {
		t.Errorf("illegal move at ply 5: problem = %v", pr)
	}
	malformed := slices.Clone(p.solution)
	malformed[1] = "d7-d5"
	if pr := expectProblem(t, c.guess(3, malformed), http.StatusUnprocessableEntity); pr["ply"] != float64(2) {
		t.Errorf("malformed move at ply 2: problem = %v", pr)
	}
	if n := api.count("SELECT count(*) FROM guesses"); n != 0 {
		t.Fatalf("rejected guesses were stored (%d)", n)
	}

	wrong := c.guess(3, wrongGuess(11)).json(t)
	if wrong["feedback"] != strings.Repeat("X", 11) || wrong["status"] != "in_progress" || wrong["guessesUsed"] != float64(1) {
		t.Fatalf("wrong guess = %v", wrong)
	}
	if _, ok := wrong["solution"]; ok {
		t.Fatal("a wrong guess revealed the solution")
	}

	solved := c.guess(3, p.solution).json(t)
	if solved["feedback"] != strings.Repeat("G", 11) || solved["status"] != "solved" || solved["guessesUsed"] != float64(2) {
		t.Fatalf("solving guess = %v", solved)
	}
	if fmt.Sprint(solved["solution"]) != fmt.Sprint(toAny(p.solution)) {
		t.Fatalf("solution = %v", solved["solution"])
	}
	expectProblem(t, c.guess(3, p.solution), http.StatusConflict)
	expectProblem(t, c.hint(3), http.StatusConflict)

	got := c.get("/api/daily/3").json(t)
	if got["attempt"].(map[string]any)["status"] != "solved" || got["solution"] == nil {
		t.Fatalf("GET after solving = %v", got)
	}
}

// A different game reaching the same placement and side to move also solves (SPEC §8.2).
func TestTranspositionSolves(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(1)
	r := c.guess(1, []string{"g1f3", "b8c6", "e2e4", "e7e5"}).json(t)
	if r["status"] != "solved" || r["feedback"] != "YYYY" {
		t.Fatalf("transposition = %v", r)
	}
}

func TestSixWrongGuessesFail(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	for i := 1; i <= 6; i++ {
		r := c.guess(3, wrongGuess(11)).json(t)
		want := "in_progress"
		if i == 6 {
			want = "failed"
		}
		if r["status"] != want || r["guessesUsed"] != float64(i) {
			t.Fatalf("guess %d = %v", i, r)
		}
		if _, ok := r["solution"]; ok != (i == 6) {
			t.Fatalf("guess %d: solution present = %v", i, ok)
		}
	}
	expectProblem(t, c.guess(3, wrongGuess(11)), http.StatusConflict)
	me := c.get("/api/auth/me").json(t)["stats"].(map[string]any)
	if me["played"] != float64(1) || me["solved"] != float64(0) || me["currentStreak"] != float64(0) {
		t.Fatalf("stats after a failure = %v", me)
	}
}

func TestHints(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	expectProblem(t, c.hint(3), http.StatusConflict) // no session
	c.start(3)

	h1 := c.hint(3).json(t)
	hint := h1["hint"].(map[string]any)
	if h1["hintIndex"] != float64(1) || hint["kind"] != "movers" {
		t.Fatalf("hint 1 = %v", h1)
	}
	white := fmt.Sprint(hint["white"])
	for _, piece := range []string{"pawn", "knight", "bishop", "king", "rook"} { // castling moves the rook too
		if !strings.Contains(white, piece) {
			t.Errorf("hint 1 white movers %s lack %s", white, piece)
		}
	}

	h2 := c.hint(3).json(t)["hint"].(map[string]any)
	if h2["kind"] != "captures" || fmt.Sprint(h2["plies"]) != "[3 4]" || h2["text"] != "2 captures, on plies 3 and 4." {
		t.Fatalf("hint 2 = %v", h2)
	}

	// Hint 3 reveals the first ply that isn't green in the latest guess: ply 1 after an all-gray guess.
	c.guess(3, wrongGuess(11))
	h3 := c.hint(3).json(t)["hint"].(map[string]any)
	if h3["kind"] != "move" || h3["ply"] != float64(1) || h3["uci"] != "e2e4" || h3["san"] != "e4" || h3["text"] != "Ply 1 (White): e4." {
		t.Fatalf("hint 3 = %v", h3)
	}
	expectProblem(t, c.hint(3), http.StatusConflict)

	// It stays the same after a guess that gets ply 1 right.
	better := []string{"e2e4", "b8a6", "b1a3", "a6b8", "a3b1", "b8a6", "b1a3", "a6b8", "a3b1", "b8a6", "h2h3"}
	if fb := c.guess(3, better).json(t)["feedback"]; !strings.HasPrefix(fb.(string), "G") {
		t.Fatalf("feedback %v", fb)
	}
	hints := c.get("/api/daily/3").json(t)["attempt"].(map[string]any)["hints"].([]any)
	if len(hints) != 3 || hints[2].(map[string]any)["ply"] != float64(1) {
		t.Fatalf("hints after another guess = %v", hints)
	}
}

// The solution never leaves the server before the attempt is finished (CLAUDE.md). Puzzle #3's
// solution shares no move with the wrong guesses, so any solution move in a response is a leak,
// except the one move hint 3 reveals.
func TestNoSolutionLeak(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	p := api.today()

	check := func(what string, r response, allowed ...string) {
		t.Helper()
		body := string(r.body)
		if strings.Contains(body, `"solution"`) {
			t.Fatalf("%s: a solution field: %s", what, body)
		}
		for _, m := range p.solution {
			if strings.Contains(body, `"`+m+`"`) && !slices.Contains(allowed, m) {
				t.Fatalf("%s leaks solution move %s: %s", what, m, body)
			}
		}
	}
	check("GET /daily (no session)", c.get("/api/daily"))
	check("GET /daily/3 (no session)", c.get("/api/daily/3"))
	check("start", c.start(3))
	for i := range 5 {
		check(fmt.Sprintf("guess %d", i+1), c.guess(3, wrongGuess(11)))
	}
	check("hint 1", c.hint(3))
	check("hint 2", c.hint(3))
	check("hint 3", c.hint(3), "e2e4")
	check("GET /daily", c.get("/api/daily"), "e2e4")
	check("GET /daily/3", c.get("/api/daily/3"), "e2e4")
	check("GET /archive", c.get("/api/archive"))
	check("GET /leaderboards/daily/3", c.get("/api/leaderboards/daily/3"))

	// The last guess finishes the attempt, and only then the solution is sent.
	if r := c.guess(3, wrongGuess(11)).json(t); r["solution"] == nil {
		t.Fatal("the final guess didn't reveal the solution")
	}
	if c.get("/api/daily").json(t)["solution"] == nil {
		t.Fatal("GET after failing doesn't show the solution")
	}
	// Someone else still can't see it.
	check("GET /daily (other player)", api.client().get("/api/daily"))
}

// Two simultaneous sixth guesses: the attempt row lock serializes them, so exactly one is
// accepted and there is no seventh guess (SPEC §10.5).
func TestConcurrentSixthGuess(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	for range 5 {
		expectStatus(t, c.guess(3, wrongGuess(11)), http.StatusOK)
	}

	const racers = 2
	results := make([]response, racers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range racers {
		wg.Go(func() {
			<-start
			results[i] = c.guess(3, wrongGuess(11))
		})
	}
	close(start)
	wg.Wait()

	codes := []int{results[0].status, results[1].status}
	slices.Sort(codes)
	if codes[0] != http.StatusOK || codes[1] != http.StatusConflict {
		t.Fatalf("statuses = %v, want one 200 and one 409", codes)
	}
	if n := api.count("SELECT count(*) FROM guesses"); n != 6 {
		t.Fatalf("%d guesses stored, want 6", n)
	}
	if n := api.count("SELECT count(DISTINCT idx) FROM guesses"); n != 6 {
		t.Fatalf("%d distinct guess indexes, want 6", n)
	}
}

func TestArchiveAttemptsCountInNoStats(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(1)
	if r := c.guess(1, api.puzzles[0].solution).json(t); r["status"] != "solved" {
		t.Fatalf("archive solve = %v", r)
	}
	expectStatus(t, c.register("archivist"), http.StatusCreated)
	stats := c.get("/api/auth/me").json(t)["stats"].(map[string]any)
	if stats["played"] != float64(0) || stats["solved"] != float64(0) {
		t.Fatalf("an archive solve counted: %v", stats)
	}
	if entries := c.get("/api/leaderboards/daily/1").json(t)["entries"].([]any); len(entries) != 0 {
		t.Fatalf("an archive solve is on the leaderboard: %v", entries)
	}
	archive := c.get("/api/archive").json(t)["puzzles"].([]any)
	first := archive[len(archive)-1].(map[string]any)
	if first["number"] != float64(1) || first["result"].(map[string]any)["status"] != "solved" {
		t.Fatalf("archive entry for #1 = %v", first)
	}
}

func toAny(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

// Two simultaneous hints: the lock serializes them, so they're hints 1 and 2, not 1 twice.
func TestConcurrentHints(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	results := make([]response, 2)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range results {
		wg.Go(func() {
			<-start
			results[i] = c.hint(3)
		})
	}
	close(start)
	wg.Wait()
	indexes := []string{fmt.Sprint(results[0].json(t)["hintIndex"]), fmt.Sprint(results[1].json(t)["hintIndex"])}
	slices.Sort(indexes)
	if fmt.Sprint(indexes) != "[1 2]" {
		t.Fatalf("hint indexes = %v, want 1 and 2", indexes)
	}
	if n := api.count("SELECT hints_used FROM attempts"); n != 2 {
		t.Fatalf("hints_used = %d, want 2", n)
	}
}

func TestBodyLimit(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	huge := map[string]any{"moves": []string{strings.Repeat("e", 20*1024)}}
	r := c.post("/api/daily/3/guesses", huge)
	if r.status != http.StatusBadRequest && r.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("a 20 KiB body: %d %s", r.status, r.body)
	}
	if n := api.count("SELECT count(*) FROM guesses"); n != 0 {
		t.Fatalf("%d guesses stored", n)
	}
}

// Failing today's daily ends the current streak at once.
func TestFailureEndsTheStreak(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3)
	c.guess(3, api.today().solution)
	api.clock.Advance(24 * time.Hour) // day of #4
	c.start(4)
	if s := c.get("/api/auth/me").json(t)["stats"].(map[string]any); s["currentStreak"] != float64(1) {
		t.Fatalf("streak before failing = %v", s["currentStreak"])
	}
	for range 6 {
		c.guess(4, wrongGuess(2))
	}
	s := c.get("/api/auth/me").json(t)["stats"].(map[string]any)
	if s["currentStreak"] != float64(0) || s["maxStreak"] != float64(1) || s["played"] != float64(2) {
		t.Fatalf("stats after failing = %v", s)
	}
}
