//go:build integration

package store_test

import (
	"io/fs"
	"log/slog"
	"path"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/db"
	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

func TestMigrateIsIdempotentAndPingWorks(t *testing.T) {
	url := dbtest.URL(t)
	logger := slog.New(slog.DiscardHandler)

	for range 2 {
		if err := store.Migrate(t.Context(), url, logger); err != nil {
			t.Fatalf("Migrate: %v", err)
		}
	}

	st, err := store.Open(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Ping(t.Context()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestPingFailsForUnreachableDatabase(t *testing.T) {
	// Port 1 on localhost refuses connections immediately.
	st, err := store.Open(t.Context(), "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=2")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Ping(t.Context()); err == nil {
		t.Fatal("Ping succeeded against a closed port")
	}
}

func TestPendingMigrationsListsWhatTheDatabaseLacks(t *testing.T) {
	ctx := t.Context()
	url := dbtest.SchemaURL(t)
	entries, err := fs.Glob(db.Migrations, "migrations/*.sql")
	if err != nil || len(entries) < 3 {
		t.Fatalf("embedded migrations: %v, %v", entries, err)
	}
	var all []string
	for _, e := range entries {
		all = append(all, path.Base(e))
	}

	pending, err := store.PendingMigrations(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(pending, all) {
		t.Fatalf("never migrated: pending %v, want all of %v", pending, all)
	}

	if err := store.Migrate(ctx, url, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	if pending, err = store.PendingMigrations(ctx, url); err != nil || len(pending) != 0 {
		t.Fatalf("after migrating: pending %v, %v; want none", pending, err)
	}

	// The manual test's database: everything but 00003.
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err := conn.Exec(ctx, "DELETE FROM goose_db_version WHERE version_id = 3"); err != nil {
		t.Fatal(err)
	}
	if pending, err = store.PendingMigrations(ctx, url); err != nil || !slices.Equal(pending, []string{"00003_lichess_username.sql"}) {
		t.Fatalf("without 00003: pending %v, %v", pending, err)
	}
}

func TestPendingMigrationsFailsForUnreachableDatabase(t *testing.T) {
	if _, err := store.PendingMigrations(t.Context(), "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=2"); err == nil {
		t.Fatal("no error against a closed port")
	}
}
