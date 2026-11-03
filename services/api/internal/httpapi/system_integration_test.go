//go:build integration

package httpapi_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/ratelimit"
)

func TestCleanupNeedsTheCronSecret(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	for name, auth := range map[string]string{
		"no header":         "",
		"wrong secret":      "Bearer not-the-secret",
		"no Bearer prefix":  testCronSecret,
		"secret as a basic": "Basic " + testCronSecret,
	} {
		t.Run(name, func(t *testing.T) {
			expectProblem(t, c.do(http.MethodGet, "/api/internal/cleanup", nil, "Authorization", auth), http.StatusUnauthorized)
		})
	}
	expectStatus(t, c.do(http.MethodPost, "/api/internal/cleanup", nil, "Authorization", "Bearer "+testCronSecret), http.StatusMethodNotAllowed)
}

func TestCleanupIsDisabledWithoutACronSecret(t *testing.T) {
	t.Parallel()
	api := newAPIWith(t, nil, func(o *httpapi.Options) { o.CronSecret = "" })
	for _, auth := range []string{"", "Bearer ", "Bearer x"} {
		expectProblem(t, api.client().do(http.MethodGet, "/api/internal/cleanup", nil, "Authorization", auth), http.StatusUnauthorized)
	}
}

func TestCleanupDeletesExpiredRowsAndReportsTheSchedule(t *testing.T) {
	t.Parallel()
	api := newAPI(t, nil)
	c := api.client()
	c.start(3) // a guest with an attempt but no guess
	expectStatus(t, c.register("sleeper"), http.StatusCreated)
	api.client().start(3) // another idle guest

	run := func() map[string]any {
		t.Helper()
		r := api.client().do(http.MethodGet, "/api/internal/cleanup", nil, "Authorization", "Bearer "+testCronSecret)
		expectStatus(t, r, http.StatusOK)
		return r.json(t)
	}

	// Today is puzzle #3, and the test schedule runs to the last test puzzle.
	got := run()
	if want := float64(len(testSolutions) - 2); got["daysScheduled"] != want {
		t.Errorf("daysScheduled = %v, want %v", got["daysScheduled"], want)
	}
	if got["sessions"] != 0.0 || got["guests"] != 0.0 {
		t.Errorf("nothing is expired yet, but the cleanup deleted %v", got)
	}

	// 31 days on, every session has expired and the idle guest is gone; the account stays.
	api.clock.Advance(31 * 24 * time.Hour)
	got = run()
	if got["sessions"].(float64) < 2 || got["guests"] != 1.0 {
		t.Errorf("after 31 days: %v, want at least 2 sessions and 1 guest", got)
	}
	if n := api.count("SELECT count(*) FROM users WHERE username = 'sleeper'"); n != 1 {
		t.Error("the cleanup deleted an account")
	}
	if got["daysScheduled"] != 0.0 {
		t.Errorf("daysScheduled = %v after the schedule ran out, want 0", got["daysScheduled"])
	}
	// Safe to repeat: the cron may deliver a run twice.
	got = run()
	if got["sessions"] != 0.0 || got["guests"] != 0.0 {
		t.Errorf("a repeated run deleted more: %v", got)
	}
	if !strings.Contains(api.logs.String(), "few puzzles left on the schedule") {
		t.Error("an exhausted schedule should be logged as a warning")
	}
}

// Behind a platform that sets X-Real-IP, rate limits key on that header, and IP addresses never
// reach the logs.
func TestClientIPHeaderKeysRateLimitsAndIsNeverLogged(t *testing.T) {
	t.Parallel()
	api := newAPIWith(t, func(c clock.Clock) httpapi.Limits {
		return httpapi.Limits{StartPerIP: ratelimit.New(c, 2, time.Hour)}
	}, func(o *httpapi.Options) { o.ClientIPHeader = "X-Real-Ip" })

	start := func(ip string) int {
		return api.client().do(http.MethodPost, "/api/daily/3/start", nil, "X-Real-Ip", ip, "X-Forwarded-For", "192.0.2.200").status
	}
	for range 2 {
		if s := start("203.0.113.77"); s != http.StatusOK {
			t.Fatalf("start from 203.0.113.77: %d", s)
		}
	}
	if s := start("203.0.113.77"); s != http.StatusTooManyRequests {
		t.Fatalf("third start from one IP: %d, want 429", s)
	}
	// Another client behind the same platform (same TCP peer, same forged X-Forwarded-For) has
	// its own limit.
	if s := start("198.51.100.23"); s != http.StatusOK {
		t.Fatalf("start from another IP: %d", s)
	}

	logs := api.logs.String()
	for _, ip := range []string{"203.0.113.77", "198.51.100.23", "192.0.2.200"} {
		if strings.Contains(logs, ip) {
			t.Errorf("IP %s appears in the logs", ip)
		}
	}
}
