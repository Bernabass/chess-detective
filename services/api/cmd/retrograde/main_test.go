package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
)

func TestRunRejectsUnknownCommands(t *testing.T) {
	for _, args := range [][]string{nil, {"bogus"}, {"serve", "extra"}} {
		var stdout, stderr bytes.Buffer
		if code := run(t.Context(), args, &stdout, &stderr); code != 2 {
			t.Errorf("run(%q) = %d, want 2", args, code)
		}
		if !strings.Contains(stderr.String(), "Usage: retrograde") {
			t.Errorf("run(%q) should print usage, got %q", args, stderr.String())
		}
	}
}

func TestMigrateWithoutDatabaseURLExplainsTheFix(t *testing.T) {
	t.Chdir(t.TempDir()) // no .env above a temp dir
	t.Setenv("DATABASE_URL", "")

	var stdout, stderr bytes.Buffer
	if code := run(t.Context(), []string{"migrate"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "copy .env.example to .env") {
		t.Errorf("stderr = %q, want a hint about .env", stderr.String())
	}
}

func TestStartupWarnsAboutScaledRateLimits(t *testing.T) {
	for scale, warned := range map[int]bool{1: false, 1000: true} {
		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))
		warnAboutSettings(t.Context(), logger, config.Config{RateLimitScale: scale})
		got := strings.Contains(buf.String(), `"level":"WARN"`) && strings.Contains(buf.String(), "RATE_LIMIT_SCALE")
		if got != warned {
			t.Errorf("scale %d: warning logged = %v, want %v (log: %s)", scale, got, warned, buf.String())
		}
	}
}
