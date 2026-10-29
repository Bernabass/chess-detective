//go:build integration

package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/chessrules"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/leaderboard"
	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

const origin = "http://localhost:5173"

var launch = time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC) // a Monday

// The test puzzles: #1 and #2 are archive puzzles, #3 is today's, #4 is tomorrow's (unreleased).
var testSolutions = [][]string{
	{"e2e4", "e7e5", "g1f3", "b8c6"},
	{"d2d4", "d7d5", "c2c4", "d5c4"},
	// 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 4.Bc4 Nf6 5.Nf3 Bf5 6.O-O: captures and castling, for hints.
	{"e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5", "f1c4", "g8f6", "g1f3", "c8f5", "e1g1"},
	{"g1f3", "g8f6"},
}

type testPuzzle struct {
	number   int
	solution []string
	target   string
}

type testAPI struct {
	t       *testing.T
	st      *store.Store
	db      *pgxpool.Pool
	clock   *clock.Fake
	srv     *httptest.Server
	puzzles []testPuzzle
	// lichess is a fake lichess.org for Sign in with Lichess; logs captures every log line.
	lichess *fakeLichess
	logs    *syncBuffer
}

// syncBuffer is a log destination the server's goroutines can share.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p) //nolint:wrapcheck // bytes.Buffer never fails
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// newAPI starts the API on a fresh schema with the test puzzles scheduled, at noon on the day
// of puzzle #3. limits builds the rate limiters on the test clock; nil means no limits.
func newAPI(t *testing.T, limits func(clock.Clock) httpapi.Limits) *testAPI {
	t.Helper()
	st, db := dbtest.Store(t)
	clk := clock.NewFake(launch.AddDate(0, 0, 2).Add(12 * time.Hour))
	api := &testAPI{t: t, st: st, db: db, clock: clk}
	ctx := context.Background()
	for i, sol := range testSolutions {
		res, err := chessrules.Replay(sol)
		if err != nil {
			t.Fatal(err)
		}
		q := st.Queries()
		if _, err := q.InsertPuzzle(ctx, sqlcdb.InsertPuzzleParams{
			ExternalID: fmt.Sprintf("test-%d", i+1), Plies: int32(len(sol)), Target: res.TargetKey, //nolint:gosec // short test games
			Solution: sol, Difficulty: 1, Features: []string{}, SolverNodes: 1, EngineVersion: "test",
		}); err != nil {
			t.Fatal(err)
		}
		row, err := q.NextUnscheduledPuzzle(ctx, 1)
		if err != nil {
			t.Fatal(err)
		}
		if err := q.InsertSchedule(ctx, sqlcdb.InsertScheduleParams{Day: launch.AddDate(0, 0, i), Number: int32(i + 1), PuzzleID: row}); err != nil {
			t.Fatal(err)
		}
		api.puzzles = append(api.puzzles, testPuzzle{number: i + 1, solution: sol, target: res.TargetKey})
	}
	dailySvc := &daily.Service{Store: st, Clock: clk}
	var lim httpapi.Limits
	if limits != nil {
		lim = limits(clk)
	}
	base, _ := url.Parse(origin)
	api.logs = &syncBuffer{}
	logger := slog.New(slog.NewJSONHandler(api.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	api.lichess = newFakeLichess(t)
	lichessURL, _ := url.Parse(api.lichess.srv.URL)
	authSvc := &auth.Service{
		Store:   st,
		Clock:   clk,
		Lichess: &lichess.Client{BaseURL: lichessURL, ClientID: "localhost:5173", HTTP: api.lichess.srv.Client()},
		Logger:  logger,
	}
	handler := httpapi.NewHandler(httpapi.Options{
		Logger:      logger,
		DB:          st,
		Clock:       clk,
		Auth:        authSvc,
		Daily:       dailySvc,
		Leaderboard: &leaderboard.Service{Store: st, Clock: clk, Puzzles: dailySvc},
		Limits:      lim,
		BaseURL:     base,
	})
	api.srv = httptest.NewServer(handler)
	t.Cleanup(api.srv.Close)
	authSvc.LichessCallback = api.srv.URL + "/api/auth/lichess/callback"
	return api
}

// today is the test puzzle released today (#3).
func (a *testAPI) today() testPuzzle { return a.puzzles[2] }

// count returns a single number from SQL (for checking what was or wasn't created).
func (a *testAPI) count(sql string, args ...any) int {
	a.t.Helper()
	var n int
	if err := a.db.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		a.t.Fatal(err)
	}
	return n
}

// client is a browser: it keeps cookies and sends the headers the web app sends.
type client struct {
	api  *testAPI
	http *http.Client
}

func (a *testAPI) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{api: a, http: &http.Client{Jar: jar}}
}

type response struct {
	status int
	header http.Header
	body   []byte
}

func (r response) json(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatalf("response %d is not a JSON object: %s", r.status, r.body)
	}
	return v
}

func (c *client) do(method, path string, body any, headers ...string) response {
	c.api.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.api.t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, c.api.srv.URL+path, reader)
	if err != nil {
		c.api.t.Fatal(err)
	}
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			req.Header.Del(headers[i])
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.api.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		c.api.t.Fatal(err)
	}
	return response{status: resp.StatusCode, header: resp.Header, body: raw}
}

func (c *client) get(path string) response { return c.do(http.MethodGet, path, nil) }
func (c *client) post(path string, body any) response {
	return c.do(http.MethodPost, path, body)
}

func (c *client) start(number int) response {
	c.api.t.Helper()
	r := c.post(fmt.Sprintf("/api/daily/%d/start", number), map[string]any{})
	if r.status != http.StatusOK {
		c.api.t.Fatalf("start #%d: %d %s", number, r.status, r.body)
	}
	return r
}

func (c *client) guess(number int, moves []string) response {
	return c.post(fmt.Sprintf("/api/daily/%d/guesses", number), map[string]any{"moves": moves})
}

func (c *client) hint(number int) response {
	return c.post(fmt.Sprintf("/api/daily/%d/hints", number), map[string]any{})
}

func (c *client) register(username string) response {
	return c.post("/api/auth/register", map[string]any{"username": username, "password": "a long password"})
}

// wrongGuess is a legal game of n plies that doesn't solve any test puzzle: knights out and
// back (and one pawn move when n is odd). None of its moves is in a test solution except g1f3
// and g8f6, which are only in #4's.
func wrongGuess(n int) []string {
	cycle := []string{"b1a3", "b8a6", "a3b1", "a6b8"}
	out := make([]string, 0, n)
	for len(out) < n-1 || (len(out) < n && n%2 == 0) {
		out = append(out, cycle[len(out)%4])
	}
	if len(out) < n {
		out = append(out, "h2h3")
	}
	return out
}

func expectStatus(t *testing.T, r response, want int) {
	t.Helper()
	if r.status != want {
		t.Fatalf("status = %d, want %d: %s", r.status, want, r.body)
	}
}

// expectProblem checks a problem+json error.
func expectProblem(t *testing.T, r response, status int) map[string]any {
	t.Helper()
	expectStatus(t, r, status)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	return r.json(t)
}
