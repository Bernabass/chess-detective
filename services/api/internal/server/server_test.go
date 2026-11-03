package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
)

func TestStartupWarnsAboutScaledRateLimits(t *testing.T) {
	for scale, warned := range map[int]bool{1: false, 1000: true} {
		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))
		WarnAboutSettings(t.Context(), logger, config.Config{RateLimitScale: scale})
		got := strings.Contains(buf.String(), `"level":"WARN"`) && strings.Contains(buf.String(), "RATE_LIMIT_SCALE")
		if got != warned {
			t.Errorf("scale %d: warning logged = %v, want %v (log: %s)", scale, got, warned, buf.String())
		}
	}
}

func TestStartupWithAnUnreachableDatabaseLogsAnErrorAndStarts(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	err := CheckMigrations(t.Context(), logger, "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=2")
	if err != nil {
		t.Fatalf("CheckMigrations = %v, want nil (/api/health reports the database)", err)
	}
	if !strings.Contains(buf.String(), `"level":"ERROR"`) || !strings.Contains(buf.String(), "pending migrations") {
		t.Errorf("want an error about the skipped check, got %s", buf.String())
	}
}

// Unsafe production settings stop the server before it touches the database or a port.
func TestRunRefusesUnsafeProductionSettings(t *testing.T) {
	cfg, err := config.Load(func(key string) (string, bool) {
		v, ok := map[string]string{
			"APP_ENV":      "production",
			"DATABASE_URL": "postgres://nobody@127.0.0.1:1/none",
			"BASE_URL":     "http://localhost:5173",
		}[key]
		return v, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	err = Run(t.Context(), cfg, slog.New(slog.NewJSONHandler(&buf, nil)))
	if err == nil {
		t.Fatal("Run started with unsafe production settings")
	}
	for _, want := range []string{"COOKIE_SECURE", "BASE_URL", "LAUNCH_DATE"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should name %s: %v", want, err)
		}
	}
	if strings.Contains(buf.String(), "pending migrations") {
		t.Error("the database was contacted before the settings were checked")
	}
}

func TestWithWebAppTurnsAPanicIntoA500(t *testing.T) {
	boom := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })
	w := httptest.NewRecorder()
	WithWebApp(boom, boom).ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), "GET", "/daily", nil))
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status %d, want 500", w.Code)
	}
}

func TestWithWebAppRoutesByPrefix(t *testing.T) {
	tag := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(name)) })
	}
	h := WithWebApp(tag("api"), tag("web"))
	for path, want := range map[string]string{"/api/health": "api", "/api/daily/3": "api", "/": "web", "/daily/3": "web", "/apiary": "web"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), "GET", path, nil))
		if w.Body.String() != want {
			t.Errorf("%s went to %s, want %s", path, w.Body.String(), want)
		}
	}
}
