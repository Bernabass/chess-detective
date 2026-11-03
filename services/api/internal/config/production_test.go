package config

import (
	"maps"
	"strings"
	"testing"
)

// safeProduction is a production configuration that passes every check.
var safeProduction = map[string]string{
	"APP_ENV":       "production",
	"DATABASE_URL":  "postgres://app@db.internal:5432/retrograde?sslmode=require",
	"BASE_URL":      "https://retrograde.example",
	"COOKIE_SECURE": "true",
	"LAUNCH_DATE":   "2026-11-10",
}

// safeVercel is the same on Vercel, which also needs the cron secret and the client IP header.
var safeVercel = map[string]string{
	"VERCEL":           "1",
	"VERCEL_ENV":       "production",
	"DATABASE_URL":     "postgres://app@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require",
	"BASE_URL":         "https://retrograde-chess.vercel.app",
	"COOKIE_SECURE":    "true",
	"LAUNCH_DATE":      "2026-11-10",
	"CRON_SECRET":      strings.Repeat("s", 32),
	"CLIENT_IP_HEADER": "X-Real-IP",
}

func with(base map[string]string, changes map[string]string) map[string]string {
	m := maps.Clone(base)
	for k, v := range changes {
		if v == "" {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	return m
}

func load(t *testing.T, env map[string]string) Config {
	t.Helper()
	cfg, err := Load(mapLookup(env))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return cfg
}

func TestProductionModeAndVercelDefaults(t *testing.T) {
	dev := load(t, map[string]string{"DATABASE_URL": "postgres://x"})
	if dev.Production || dev.OnVercel || !dev.CleanupInProcess || dev.LaunchDateSet {
		t.Errorf("development: Production %v, OnVercel %v, CleanupInProcess %v, LaunchDateSet %v",
			dev.Production, dev.OnVercel, dev.CleanupInProcess, dev.LaunchDateSet)
	}
	if !load(t, safeProduction).Production {
		t.Error("APP_ENV=production should be production mode")
	}
	v := load(t, map[string]string{"DATABASE_URL": "postgres://x", "VERCEL": "1"})
	if !v.Production || !v.OnVercel || v.CleanupInProcess {
		t.Errorf("on Vercel: Production %v, OnVercel %v, CleanupInProcess %v", v.Production, v.OnVercel, v.CleanupInProcess)
	}
	// The platform proxies to the server, so it listens on every interface unless told otherwise.
	if v.Host != "0.0.0.0" {
		t.Errorf("Host on Vercel = %q, want 0.0.0.0", v.Host)
	}
	if load(t, with(safeVercel, map[string]string{"HOST": "127.0.0.1"})).Host != "127.0.0.1" {
		t.Error("an explicit HOST must win")
	}
}

func TestVercelAddresses(t *testing.T) {
	// Production without BASE_URL: the project's production domain.
	cfg := load(t, map[string]string{
		"DATABASE_URL": "postgres://x", "VERCEL": "1", "VERCEL_ENV": "production",
		"VERCEL_PROJECT_PRODUCTION_URL": "retrograde-chess.vercel.app", "VERCEL_URL": "retrograde-chess-abc123.vercel.app",
	})
	if cfg.BaseURL.String() != "https://retrograde-chess.vercel.app" || cfg.LichessClientID != "retrograde-chess.vercel.app" {
		t.Errorf("production BaseURL = %q, client id %q", cfg.BaseURL, cfg.LichessClientID)
	}
	if strings.Join(cfg.ExtraOrigins, ",") != "https://retrograde-chess-abc123.vercel.app" {
		t.Errorf("production ExtraOrigins = %v", cfg.ExtraOrigins)
	}

	// A preview: its own deployment address (a branch alias can move to a later deployment), with
	// the branch address accepted too.
	cfg = load(t, map[string]string{
		"DATABASE_URL": "postgres://x", "VERCEL": "1", "VERCEL_ENV": "preview",
		"VERCEL_BRANCH_URL": "retrograde-chess-git-feature-bernabass.vercel.app",
		"VERCEL_URL":        "retrograde-chess-def456.vercel.app",
	})
	if cfg.BaseURL.String() != "https://retrograde-chess-def456.vercel.app" {
		t.Errorf("preview BaseURL = %q", cfg.BaseURL)
	}
	if strings.Join(cfg.ExtraOrigins, ",") != "https://retrograde-chess-git-feature-bernabass.vercel.app" {
		t.Errorf("preview ExtraOrigins = %v", cfg.ExtraOrigins)
	}

	// A preview without a branch address.
	cfg = load(t, map[string]string{
		"DATABASE_URL": "postgres://x", "VERCEL": "1", "VERCEL_ENV": "preview", "VERCEL_URL": "retrograde-chess-def456.vercel.app",
	})
	if cfg.BaseURL.String() != "https://retrograde-chess-def456.vercel.app" || len(cfg.ExtraOrigins) != 0 {
		t.Errorf("preview without branch: BaseURL %q, ExtraOrigins %v", cfg.BaseURL, cfg.ExtraOrigins)
	}

	// An explicit BASE_URL always wins.
	if load(t, safeVercel).BaseURL.String() != "https://retrograde-chess.vercel.app" {
		t.Error("explicit BASE_URL ignored")
	}
}

func TestClientIPHeaderSetting(t *testing.T) {
	if got := load(t, safeVercel).ClientIPHeader; got != "X-Real-Ip" {
		t.Errorf("ClientIPHeader = %q, want the canonical X-Real-Ip", got)
	}
	_, err := Load(mapLookup(with(safeVercel, map[string]string{"TRUSTED_PROXIES": "10.0.0.0/8"})))
	if err == nil || !strings.Contains(err.Error(), "CLIENT_IP_HEADER") {
		t.Errorf("CLIENT_IP_HEADER with TRUSTED_PROXIES: err = %v", err)
	}
	for _, bad := range []string{"X Real IP", "X-Real-IP:", "é"} {
		_, err := Load(mapLookup(with(safeVercel, map[string]string{"CLIENT_IP_HEADER": bad})))
		if err == nil || !strings.Contains(err.Error(), "CLIENT_IP_HEADER") {
			t.Errorf("CLIENT_IP_HEADER=%q: err = %v", bad, err)
		}
	}
}

func TestProductionChecksPassForSafeSettings(t *testing.T) {
	for name, env := range map[string]map[string]string{"production": safeProduction, "vercel": safeVercel} {
		if problems := load(t, env).ProductionProblems(); len(problems) != 0 {
			t.Errorf("%s: unexpected problems %v", name, problems)
		}
	}
	// Development is never checked.
	if problems := load(t, map[string]string{"DATABASE_URL": "postgres://x"}).ProductionProblems(); len(problems) != 0 {
		t.Errorf("development: %v", problems)
	}
}

func TestProductionChecksRefuseUnsafeSettings(t *testing.T) {
	for _, c := range []struct {
		name    string
		base    map[string]string
		changes map[string]string
		want    string
	}{
		{"insecure cookie", safeProduction, map[string]string{"COOKIE_SECURE": "false"}, "COOKIE_SECURE"},
		{"cookie not set", safeProduction, map[string]string{"COOKIE_SECURE": ""}, "COOKIE_SECURE"},
		{"http address", safeProduction, map[string]string{"BASE_URL": "http://retrograde.example"}, "BASE_URL"},
		{"localhost address", safeProduction, map[string]string{"BASE_URL": "https://localhost:5173"}, "BASE_URL"},
		{"loopback address", safeProduction, map[string]string{"BASE_URL": "https://127.0.0.1"}, "BASE_URL"},
		{"default address", safeProduction, map[string]string{"BASE_URL": ""}, "BASE_URL"},
		{"scaled limits", safeProduction, map[string]string{"RATE_LIMIT_SCALE": "1000"}, "RATE_LIMIT_SCALE"},
		{"default launch date", safeProduction, map[string]string{"LAUNCH_DATE": ""}, "LAUNCH_DATE"},
		{"trust every proxy", safeProduction, map[string]string{"TRUSTED_PROXIES": "0.0.0.0/0"}, "TRUSTED_PROXIES"},
		{"trust every IPv6 proxy", safeProduction, map[string]string{"TRUSTED_PROXIES": "::/0"}, "TRUSTED_PROXIES"},
		{"fake Lichess", safeProduction, map[string]string{"LICHESS_BASE_URL": "http://127.0.0.1:8093"}, "LICHESS_BASE_URL"},
		{"short cron secret", safeProduction, map[string]string{"CRON_SECRET": "short"}, "CRON_SECRET"},
		{"no cron secret on Vercel", safeVercel, map[string]string{"CRON_SECRET": ""}, "CRON_SECRET"},
		{"no client IP header on Vercel", safeVercel, map[string]string{"CLIENT_IP_HEADER": ""}, "CLIENT_IP_HEADER"},
		{"local database on Vercel", safeVercel, map[string]string{"DATABASE_URL": "postgres://app@localhost:5432/retrograde?sslmode=require"}, "DATABASE_URL"},
		{"no TLS to the database on Vercel", safeVercel, map[string]string{"DATABASE_URL": "postgres://app@ep-x.neon.tech/neondb?sslmode=disable"}, "DATABASE_URL"},
	} {
		problems := load(t, with(c.base, c.changes)).ProductionProblems()
		found := false
		for _, p := range problems {
			found = found || strings.Contains(p.Error(), c.want)
		}
		if !found {
			t.Errorf("%s: problems %v, want one about %s", c.name, problems, c.want)
		}
	}
}
