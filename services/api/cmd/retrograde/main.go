// Command retrograde is the Retrograde API server and its admin tasks.
//
//	retrograde serve     run the HTTP API
//	retrograde migrate   apply database migrations
//
// Settings come from environment variables, falling back to the nearest .env
// file above the working directory (SPEC §10.2).
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

const usage = `Usage: retrograde <command>

Commands:
  serve     run the HTTP API
  migrate   apply database migrations
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	// After the first Ctrl+C, restore default signal handling so a second one exits immediately.
	context.AfterFunc(ctx, stop)
	code := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 || (args[0] != "serve" && args[0] != "migrate") {
		_, _ = fmt.Fprint(stderr, usage)
		return 2
	}
	command := args[0]

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

func serve(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           httpapi.NewHandler(httpapi.Options{Logger: logger, DB: st}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

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
