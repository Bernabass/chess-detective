// Package dbtest gives integration tests the test database (TEST_DATABASE_URL),
// never the development database.
package dbtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

// URL returns TEST_DATABASE_URL from the environment or the project .env file.
// Integration tests need it, so a missing value fails the test with a hint.
func URL(t testing.TB) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	lookup, err := config.Environ(wd)
	if err != nil {
		t.Fatal(err)
	}
	url, ok := lookup("TEST_DATABASE_URL")
	if !ok || url == "" {
		t.Fatal("TEST_DATABASE_URL is not set: add it to .env (see .env.example). " +
			"It must point at the retrograde_test database.")
	}
	return url
}

// Store returns a store on a fresh, fully migrated schema of the test database, dropped when
// the test ends, so integration tests are isolated and can run in parallel. The pool is a
// second connection to the same schema, for test setup and assertions in raw SQL.
func Store(t testing.TB) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	base := URL(t)

	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	schema := "t_" + hex.EncodeToString(buf)

	conn, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connecting to TEST_DATABASE_URL: %v", err)
	}
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := conn.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("dropping test schema %s: %v", schema, err)
		}
		_ = conn.Close(context.Background())
	})

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema+",public") // pgx passes unknown parameters to the server
	u.RawQuery = q.Encode()
	schemaURL := u.String()

	if err := store.Migrate(ctx, schemaURL, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatalf("migrating test schema: %v", err)
	}
	st, err := store.Open(ctx, schemaURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	pool, err := pgxpool.New(ctx, schemaURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return st, pool
}
