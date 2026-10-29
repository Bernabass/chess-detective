// Command retrograde is the Retrograde API server and its admin tasks.
//
//	retrograde serve                            run the HTTP API (and the hourly cleanup)
//	retrograde migrate                          apply database migrations
//	retrograde import-puzzles <file.jsonl>      load generated puzzles (idempotent)
//	retrograde schedule --from YYYY-MM-DD --days N   assign puzzles to days by the weekly ramp
//	retrograde cleanup                          delete expired sessions and idle guests now
//
// Settings come from environment variables, falling back to the nearest .env
// file above the working directory (SPEC §10.2).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/leaderboard"
	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

const usage = `Usage: retrograde <command>

Commands:
  serve                                     run the HTTP API (and the hourly cleanup)
  migrate                                   apply database migrations
  import-puzzles <file.jsonl>               load generated puzzles (idempotent)
  schedule --from YYYY-MM-DD --days N       assign puzzles to days by the weekly ramp
  cleanup                                   delete expired sessions and idle guests now
`

// cleanupInterval is how often serve runs the cleanup job.
const cleanupInterval = time.Hour

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	// After the first Ctrl+C, restore default signal handling so a second one exits immediately.
	context.AfterFunc(ctx, stop)
	code := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		_, _ = fmt.Fprint(stderr, usage)
		return 2
	}
	command, rest := args[0], args[1:]
	switch command {
	case "serve", "migrate", "cleanup":
		if len(rest) != 0 {
			_, _ = fmt.Fprint(stderr, usage)
			return 2
		}
	case "import-puzzles":
		if len(rest) != 1 {
			_, _ = fmt.Fprint(stderr, usage)
			return 2
		}
	case "schedule":
	default:
		_, _ = fmt.Fprint(stderr, usage)
		return 2
	}

	cfg, err := loadConfig()
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "retrograde %s: configuration error:\n%v\n", command, err)
		return 1
	}
	logger := slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))

	switch command {
	case "serve":
		err = serve(ctx, cfg, logger)
	case "migrate":
		err = store.Migrate(ctx, cfg.DatabaseURL, logger)
	case "import-puzzles":
		err = importPuzzles(ctx, cfg, rest[0], stdout)
	case "schedule":
		err = schedule(ctx, cfg, rest, stdout, stderr)
	case "cleanup":
		err = cleanup(ctx, cfg, stdout)
	}
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "retrograde %s: %v\n", command, err)
		return 1
	}
	return 0
}

func loadConfig() (config.Config, error) {
	wd, err := os.Getwd()
	if err != nil {
		return config.Config{}, fmt.Errorf("finding working directory: %w", err)
	}
	lookup, err := config.Environ(wd)
	if err != nil {
		return config.Config{}, fmt.Errorf("reading .env: %w", err)
	}
	return config.Load(lookup)
}

func openStore(ctx context.Context, cfg config.Config) (*store.Store, error) {
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err //nolint:wrapcheck // already wrapped
	}
	return st, nil
}

func importPuzzles(ctx context.Context, cfg config.Config, path string, stdout io.Writer) error {
	f, err := os.Open(path) //nolint:gosec // an admin command reading the file it was given
	if err != nil {
		return fmt.Errorf("opening %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	report, err := daily.ImportPuzzles(ctx, st, f)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	_, _ = fmt.Fprintf(stdout, "imported %d puzzles (%d already present)\n", report.Inserted, report.Skipped)
	return printPool(ctx, st, stdout)
}

func schedule(ctx context.Context, cfg config.Config, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("schedule", flag.ContinueOnError)
	fs.SetOutput(stderr)
	from := fs.String("from", "", "first day to schedule (YYYY-MM-DD, UTC)")
	days := fs.Int("days", 0, "number of days to schedule")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("bad arguments: %w", err)
	}
	start, err := time.Parse(time.DateOnly, *from)
	if err != nil {
		return errors.New("--from must be a date like 2026-11-01")
	}
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	report, err := daily.Schedule(ctx, st, cfg.LaunchDate, start, *days)
	if err == nil {
		_, _ = fmt.Fprintf(stdout, "scheduled %d days (%d already scheduled) from %s; LAUNCH_DATE %s is puzzle #1\n",
			report.Assigned, report.Kept, start.Format(time.DateOnly), cfg.LaunchDate.Format(time.DateOnly))
	} else if errors.Is(err, daily.ErrPoolExhausted) {
		_, _ = fmt.Fprintln(stdout, "nothing was scheduled")
	}
	_, _ = fmt.Fprintln(stdout, poolLine(report.Remaining))
	return err //nolint:wrapcheck // already wrapped
}

func printPool(ctx context.Context, st *store.Store, stdout io.Writer) error {
	remaining, err := daily.RemainingPool(ctx, st)
	if err != nil {
		return err //nolint:wrapcheck // already wrapped
	}
	_, _ = fmt.Fprintln(stdout, poolLine(remaining))
	return nil
}

// poolLine is "unscheduled puzzles left: ★ 70 · ★★ 140 · …" (SPEC §8.7 asks for it every time).
func poolLine(remaining [6]int) string {
	parts := make([]string, 0, 5)
	for level := 1; level <= 5; level++ {
		parts = append(parts, fmt.Sprintf("%s %d", strings.Repeat("★", level), remaining[level]))
	}
	return "unscheduled puzzles left: " + strings.Join(parts, " · ")
}

func cleanup(ctx context.Context, cfg config.Config, stdout io.Writer) error {
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	r, err := auth.Cleanup(ctx, st, clock.Real{}.Now())
	if err != nil {
		return err //nolint:wrapcheck // already wrapped
	}
	_, _ = fmt.Fprintf(stdout, "deleted %d expired sessions, %d idle guests, %d expired OAuth states\n", r.Sessions, r.Guests, r.OAuthStates)
	return nil
}

func serve(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	if err := checkMigrations(ctx, logger, cfg.DatabaseURL); err != nil {
		return err
	}
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()

	clk := clock.Real{}
	dailySvc := &daily.Service{Store: st, Clock: clk}
	handler := httpapi.NewHandler(httpapi.Options{
		Logger: logger,
		DB:     st,
		Clock:  clk,
		Auth: &auth.Service{
			Store: st,
			Clock: clk,
			Lichess: &lichess.Client{
				BaseURL:  cfg.LichessBaseURL,
				ClientID: cfg.LichessClientID,
				HTTP:     &http.Client{Timeout: 10 * time.Second},
			},
			LichessCallback: strings.TrimSuffix(cfg.BaseURL.String(), "/") + "/api/auth/lichess/callback",
			Logger:          logger,
		},
		Daily:          dailySvc,
		Leaderboard:    &leaderboard.Service{Store: st, Clock: clk, Puzzles: dailySvc},
		Limits:         httpapi.DefaultLimits(clk, cfg.RateLimitScale),
		BaseURL:        cfg.BaseURL,
		CookieSecure:   cfg.CookieSecure,
		TrustedProxies: cfg.TrustedProxies,
	})
	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	warnAboutSettings(ctx, logger, cfg)
	go runCleanup(ctx, st, clk, logger)

	errCh := make(chan error, 1)
	go func() {
		logger.InfoContext(ctx, "listening", "addr", "http://"+cfg.Addr())
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil { //nolint:contextcheck // the request context is already cancelled
		return fmt.Errorf("shutting down: %w", err)
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http server: %w", err)
	}
	return nil
}

// checkMigrations refuses to serve a database that lacks some of this binary's migrations: the
// first query touching the missing schema would fail much later (DECISIONS 2026-10-29). A
// database that can't be reached doesn't stop the start-up; /api/health reports it.
func checkMigrations(ctx context.Context, logger *slog.Logger, databaseURL string) error {
	pending, err := store.PendingMigrations(ctx, databaseURL)
	if err != nil {
		logger.ErrorContext(ctx, "couldn't check the database for pending migrations; starting anyway", "err", err)
		return nil
	}
	switch len(pending) {
	case 0:
		return nil
	case 1:
		return fmt.Errorf("the database is missing migration %s: run `pnpm db:migrate` (or `retrograde migrate`), then start again", pending[0])
	default:
		return fmt.Errorf("the database is missing %d migrations (%s): run `pnpm db:migrate` (or `retrograde migrate`), then start again",
			len(pending), strings.Join(pending, ", "))
	}
}

// warnAboutSettings logs a warning for settings that must not go unnoticed in production.
func warnAboutSettings(ctx context.Context, logger *slog.Logger, cfg config.Config) {
	if cfg.RateLimitScale != 1 {
		logger.WarnContext(ctx, "RATE_LIMIT_SCALE is not 1: every rate limit is multiplied (meant for tests, never production)",
			"rate_limit_scale", cfg.RateLimitScale)
	}
}

// runCleanup runs the cleanup job at startup and then every hour until ctx ends.
func runCleanup(ctx context.Context, st *store.Store, clk clock.Clock, logger *slog.Logger) {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		r, err := auth.Cleanup(ctx, st, clk.Now())
		if err != nil && ctx.Err() == nil {
			logger.WarnContext(ctx, "cleanup failed", "err", err)
		} else if err == nil && r.Sessions+r.Guests+r.OAuthStates > 0 {
			logger.InfoContext(ctx, "cleanup", "sessions", r.Sessions, "guests", r.Guests, "oauth_states", r.OAuthStates)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
