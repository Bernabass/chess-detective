// Command e2e-setup prepares the database for the web app's end-to-end tests: it drops and
// recreates the "e2e" schema in the test database (TEST_DATABASE_URL), migrates it, imports
// the fixture puzzles and schedules them from --launch. Never part of the production binary;
// scripts/e2e-api.mjs runs it before starting the API on that schema.
//
//	e2e-setup --puzzles apps/web/e2e/fixtures/puzzles.jsonl --launch 2026-10-26 --days 5
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

// Schema is where the e2e data lives, inside the test database.
const Schema = "e2e"

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "e2e-setup: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("e2e-setup", flag.ContinueOnError)
	puzzles := fs.String("puzzles", "", "JSONL file of puzzles to import")
	launch := fs.String("launch", "", "LAUNCH_DATE (YYYY-MM-DD): puzzle #1's day")
	days := fs.Int("days", 0, "days to schedule from --launch")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("bad arguments: %w", err)
	}
	launchDay, err := time.Parse(time.DateOnly, *launch)
	if err != nil || *puzzles == "" || *days < 1 {
		return errors.New("usage: e2e-setup --puzzles FILE --launch YYYY-MM-DD --days N")
	}

	wd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("finding working directory: %w", err)
	}
	lookup, err := config.Environ(wd)
	if err != nil {
		return fmt.Errorf("reading .env: %w", err)
	}
	base, ok := lookup("TEST_DATABASE_URL")
	if !ok || base == "" {
		return errors.New("TEST_DATABASE_URL is not set: add it to .env (see .env.example)")
	}
	schemaURL, err := SchemaURL(base)
	if err != nil {
		return err
	}

	if err := resetSchema(ctx, base); err != nil {
		return err
	}
	if err := store.Migrate(ctx, schemaURL, slog.New(slog.DiscardHandler)); err != nil {
		return fmt.Errorf("migrating: %w", err)
	}
	st, err := store.Open(ctx, schemaURL)
	if err != nil {
		return fmt.Errorf("opening store: %w", err)
	}
	defer st.Close()

	f, err := os.Open(*puzzles) //nolint:gosec // a dev command reading the file it was given
	if err != nil {
		return fmt.Errorf("opening %s: %w", *puzzles, err)
	}
	defer func() { _ = f.Close() }()
	imported, err := daily.ImportPuzzles(ctx, st, f)
	if err != nil {
		return fmt.Errorf("importing %s: %w", *puzzles, err)
	}
	scheduled, err := daily.Schedule(ctx, st, launchDay, launchDay, *days)
	if err != nil {
		return fmt.Errorf("scheduling: %w", err)
	}
	_, _ = fmt.Fprintf(stdout, "e2e-setup: schema %q ready: %d puzzles, %d days from %s\n",
		Schema, imported.Inserted, scheduled.Assigned, launchDay.Format(time.DateOnly))
	return nil
}

// SchemaURL is the test database URL with the e2e schema first on the search path. It refuses
// any database whose name doesn't end in "_test", so it can never touch real data.
func SchemaURL(testURL string) (string, error) {
	u, err := url.Parse(testURL)
	if err != nil {
		return "", errors.New("TEST_DATABASE_URL is not a valid URL")
	}
	if name := strings.TrimPrefix(u.Path, "/"); !strings.HasSuffix(name, "_test") {
		return "", fmt.Errorf("TEST_DATABASE_URL must name a database ending in _test, not %q", name)
	}
	q := u.Query()
	q.Set("search_path", Schema+",public")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func resetSchema(ctx context.Context, testURL string) error {
	conn, err := pgx.Connect(ctx, testURL)
	if err != nil {
		return fmt.Errorf("connecting to TEST_DATABASE_URL: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	// The URL's path was checked, but pgx also honours ?dbname=: check where we really are.
	var name string
	if err := conn.QueryRow(ctx, "SELECT current_database()").Scan(&name); err != nil {
		return fmt.Errorf("checking the database: %w", err)
	}
	if !strings.HasSuffix(name, "_test") {
		return fmt.Errorf("refusing to touch database %q: TEST_DATABASE_URL must point at a database ending in _test", name)
	}
	for _, sql := range []string{
		"DROP SCHEMA IF EXISTS " + Schema + " CASCADE",
		"CREATE EXTENSION IF NOT EXISTS citext SCHEMA public",
		"CREATE SCHEMA " + Schema,
	} {
		if _, err := conn.Exec(ctx, sql); err != nil {
			return fmt.Errorf("resetting the %s schema: %w", Schema, err)
		}
	}
	return nil
}
