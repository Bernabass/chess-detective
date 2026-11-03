// Command server runs the HTTP API with settings from the environment. It's the entry point
// the Vercel Go runtime builds; elsewhere `retrograde serve` does the same.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/server"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	context.AfterFunc(ctx, stop)
	err := run(ctx)
	stop()
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "server: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	wd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("finding working directory: %w", err)
	}
	lookup, err := config.Environ(wd)
	if err != nil {
		return fmt.Errorf("reading .env: %w", err)
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return fmt.Errorf("configuration error:\n%w", err)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	return server.Run(ctx, cfg, logger) //nolint:wrapcheck // server errors are already descriptive
}
