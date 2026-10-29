package config

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mapLookup(m map[string]string) Lookup {
	return func(key string) (string, bool) {
		v, ok := m[key]
		return v, ok
	}
}

func TestParseDotEnv(t *testing.T) {
	input := "\xef\xbb\xbf# comment\n\n" +
		"DATABASE_URL=postgres://localhost:5432/db?sslmode=disable&application_name=a%40b\n" +
		"export PORT = 9090\n" +
		"QUOTED=\"has # hash\"\n" +
		"QUOTED_COMMENT=\"v\" # comment\n" +
		"SINGLE='x y'\n" +
		"INLINE=value # trailing comment\n" +
		"EMPTY=\n"
	got, err := ParseDotEnv(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"DATABASE_URL":   "postgres://localhost:5432/db?sslmode=disable&application_name=a%40b",
		"PORT":           "9090",
		"QUOTED":         "has # hash",
		"QUOTED_COMMENT": "v",
		"SINGLE":         "x y",
		"INLINE":         "value",
		"EMPTY":          "",
	}
	if len(got) != len(want) {
		t.Fatalf("got %d keys %v, want %d", len(got), got, len(want))
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestParseDotEnvRejectsBadLines(t *testing.T) {
	for _, input := range []string{"NO_EQUALS\n", "1BAD=x\n", "=x\n"} {
		if _, err := ParseDotEnv(strings.NewReader(input)); err == nil {
			t.Errorf("ParseDotEnv(%q) succeeded, want error", input)
		}
	}
}

func TestFindDotEnvSearchesUpwardAndStopsAtRepoRoot(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "my project") // paths with spaces must work
	nested := filepath.Join(repo, "services", "api")
	mustMkdir(t, filepath.Join(repo, ".git"))
	mustMkdir(t, nested)

	// A .env above the repository root must not be picked up.
	mustWrite(t, filepath.Join(root, ".env"), "PORT=1\n")
	if got, err := FindDotEnv(nested); err != nil || got != "" {
		t.Fatalf("FindDotEnv = %q, %v; want no file", got, err)
	}

	want := filepath.Join(repo, ".env")
	mustWrite(t, want, "PORT=2\n")
	if got, err := FindDotEnv(nested); err != nil || got != want {
		t.Fatalf("FindDotEnv = %q, %v; want %q", got, err, want)
	}
}

func TestEnvironPrefersRealEnvironment(t *testing.T) {
	repo := t.TempDir()
	mustMkdir(t, filepath.Join(repo, ".git"))
	mustWrite(t, filepath.Join(repo, ".env"), "RG_TEST_FROM_FILE=file\nRG_TEST_BOTH=file\nRG_TEST_EMPTY_ENV=file\n")
	t.Setenv("RG_TEST_BOTH", "env")
	t.Setenv("RG_TEST_EMPTY_ENV", "")

	lookup, err := Environ(repo)
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := lookup("RG_TEST_FROM_FILE"); v != "file" {
		t.Errorf("RG_TEST_FROM_FILE = %q, want file", v)
	}
	if v, _ := lookup("RG_TEST_BOTH"); v != "env" {
		t.Errorf("RG_TEST_BOTH = %q, want env (real environment wins)", v)
	}
	if v, _ := lookup("RG_TEST_EMPTY_ENV"); v != "file" {
		t.Errorf("RG_TEST_EMPTY_ENV = %q, want file (an empty variable must not hide .env)", v)
	}
	if _, ok := lookup("RG_TEST_UNSET"); ok {
		t.Error("RG_TEST_UNSET should not be set")
	}
	if _, ok := os.LookupEnv("RG_TEST_FROM_FILE"); ok {
		t.Error("Environ must not modify the process environment")
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr() != "127.0.0.1:8080" {
		t.Errorf("Addr = %q", cfg.Addr())
	}
	if cfg.BaseURL.String() != "http://localhost:5173" {
		t.Errorf("BaseURL = %q", cfg.BaseURL)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v", cfg.LogLevel)
	}
}

func TestAddrBracketsIPv6(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x", "HOST": "::1"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr() != "[::1]:8080" {
		t.Errorf("Addr = %q, want [::1]:8080", cfg.Addr())
	}
}

func TestLoadMissingDatabaseURL(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{"DATABASE_URL": "  "}))
	if !errors.Is(err, ErrMissingDatabaseURL) {
		t.Fatalf("err = %v, want ErrMissingDatabaseURL", err)
	}
	if !strings.Contains(err.Error(), ".env.example") {
		t.Errorf("message should tell the user what to do: %v", err)
	}
}

func TestLoadReportsEveryInvalidSetting(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{
		"DATABASE_URL": "postgres://x",
		"PORT":         "http",
		"BASE_URL":     "localhost:5173",
		"LOG_LEVEL":    "loud",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, name := range []string{"PORT", "BASE_URL", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error should mention %s: %v", name, err)
		}
	}
}

func mustMkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRateLimitScale(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil || cfg.RateLimitScale != 1 {
		t.Fatalf("default RateLimitScale = %d (%v), want 1", cfg.RateLimitScale, err)
	}
	cfg, err = Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x", "RATE_LIMIT_SCALE": "1000"}))
	if err != nil || cfg.RateLimitScale != 1000 {
		t.Fatalf("RateLimitScale = %d (%v), want 1000", cfg.RateLimitScale, err)
	}
	for _, bad := range []string{"0", "-2", "1.5", "lots", "1000001"} {
		_, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x", "RATE_LIMIT_SCALE": bad}))
		if err == nil || !strings.Contains(err.Error(), "RATE_LIMIT_SCALE") {
			t.Errorf("RATE_LIMIT_SCALE=%q: err = %v", bad, err)
		}
	}
}

func TestLichessSettings(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LichessBaseURL.String() != "https://lichess.org" {
		t.Errorf("LichessBaseURL = %q", cfg.LichessBaseURL)
	}
	// The client id defaults to BASE_URL's host: unique, and what the consent page shows.
	if cfg.LichessClientID != "localhost:5173" {
		t.Errorf("LichessClientID = %q, want localhost:5173", cfg.LichessClientID)
	}
	cfg, err = Load(mapLookup(map[string]string{
		"DATABASE_URL":      "postgres://x",
		"BASE_URL":          "https://retrograde.example",
		"LICHESS_BASE_URL":  "http://127.0.0.1:8093/",
		"LICHESS_CLIENT_ID": "my-client",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LichessBaseURL.String() != "http://127.0.0.1:8093" || cfg.LichessClientID != "my-client" {
		t.Errorf("Lichess settings = %q, %q", cfg.LichessBaseURL, cfg.LichessClientID)
	}
	cfg, err = Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x", "BASE_URL": "https://retrograde.example"}))
	if err != nil || cfg.LichessClientID != "retrograde.example" {
		t.Errorf("LichessClientID = %q (%v), want retrograde.example", cfg.LichessClientID, err)
	}
	for _, bad := range []string{"lichess.org", "ftp://lichess.org", "https://"} {
		_, err := Load(mapLookup(map[string]string{"DATABASE_URL": "postgres://x", "LICHESS_BASE_URL": bad}))
		if err == nil || !strings.Contains(err.Error(), "LICHESS_BASE_URL") {
			t.Errorf("LICHESS_BASE_URL=%q: err = %v", bad, err)
		}
	}
}
