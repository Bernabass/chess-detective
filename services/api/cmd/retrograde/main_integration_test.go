//go:build integration

package main

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

// serve refuses to start on a database without every migration, and says how to fix it. This is
// the Phase 8 manual test's database: everything applied but 00003.
func TestServeRefusesADatabaseWithPendingMigrations(t *testing.T) {
	url := dbtest.SchemaURL(t)
	if err := store.Migrate(t.Context(), url, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(t.Context(), "DELETE FROM goose_db_version WHERE version_id = 3"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", url)

	// If the check let it through, serve would run until this deadline and exit 0.
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := run(ctx, []string{"serve"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1 (stderr %q)", code, stderr.String())
	}
	for _, want := range []string{"00003_lichess_username.sql", "pnpm db:migrate"} {
		if !strings.Contains(stderr.String(), want) {
			t.Errorf("stderr = %q, want it to mention %q", stderr.String(), want)
		}
	}
	t.Logf("stderr: %s", stderr.String())
	if strings.Contains(stdout.String(), "listening") {
		t.Error("serve started listening")
	}
}
