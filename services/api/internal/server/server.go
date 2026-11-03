// Package server runs the HTTP API (ARCHITECTURE.md §10.1): the startup checks, the handler
// (with the embedded web app in builds that have it), the hourly cleanup where the process
// lives on between requests, and a graceful shutdown. `retrograde serve` and cmd/server (the
// entry point Vercel builds) both call Run.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/leaderboard"
	"github.com/Bernabass/chess-detective/services/api/internal/lichess"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/webui"
)

// cleanupInterval is how often a long-lived server runs the cleanup job.
const cleanupInterval = time.Hour

// Run serves until ctx ends. It refuses to start with unsafe production settings or a
// database that lacks migrations.
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	if problems := cfg.ProductionProblems(); len(problems) > 0 {
		return fmt.Errorf("refusing to start with unsafe production settings:\n%w", errors.Join(problems...))
	}
	if err := CheckMigrations(ctx, logger, cfg.DatabaseURL); err != nil {
		return err
	}
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err //nolint:wrapcheck // already wrapped
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
		ExtraOrigins:   cfg.ExtraOrigins,
		ClientIPHeader: cfg.ClientIPHeader,
		CronSecret:     cfg.CronSecret,
	})
	if web := webui.Embedded(); web != nil {
		handler = WithWebApp(handler, web)
	}

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

	WarnAboutSettings(ctx, logger, cfg)
	warnAboutSchedule(ctx, logger, st, clk)
	if cfg.CleanupInProcess {
		go runCleanup(ctx, st, clk, logger)
	}

	errCh := make(chan error, 1)
	go func() {
		logger.InfoContext(ctx, "listening", "addr", "http://"+cfg.Addr(), "web_app", webui.Embedded() != nil)
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

// WithWebApp sends /api/ to the API and everything else to the web app. A panic outside the
// API's own recovery becomes a 500 here, so net/http never logs it (with the client's address).
func WithWebApp(api, web http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler { //nolint:errorlint // re-panic exactly as net/http expects
					panic(v)
				}
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		mux.ServeHTTP(w, r)
	})
}

// CheckMigrations refuses to serve a database that lacks some of this binary's migrations: the
// first query touching the missing schema would fail much later (ARCHITECTURE.md §10.1). A
// database that can't be reached doesn't stop the start-up; /api/health reports it.
func CheckMigrations(ctx context.Context, logger *slog.Logger, databaseURL string) error {
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

// WarnAboutSettings logs a warning for settings that must not go unnoticed in production.
func WarnAboutSettings(ctx context.Context, logger *slog.Logger, cfg config.Config) {
	if cfg.RateLimitScale != 1 {
		logger.WarnContext(ctx, "RATE_LIMIT_SCALE is not 1: every rate limit is multiplied (meant for tests, never production)",
			"rate_limit_scale", cfg.RateLimitScale)
	}
}

// warnAboutSchedule logs a warning when fewer than httpapi.MinScheduledDays days of puzzles
// remain scheduled.
func warnAboutSchedule(ctx context.Context, logger *slog.Logger, st *store.Store, clk clock.Clock) {
	days, err := daily.ScheduledDays(ctx, st, clock.Day(clk.Now()))
	if err != nil {
		logger.WarnContext(ctx, "couldn't count the scheduled days", "err", err)
		return
	}
	if days < httpapi.MinScheduledDays {
		logger.WarnContext(ctx, "few puzzles left on the schedule: run retrograde schedule", "days_scheduled", days)
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
