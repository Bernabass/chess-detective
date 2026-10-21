//go:build integration

package store_test

import (
	"log/slog"
	"testing"

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
