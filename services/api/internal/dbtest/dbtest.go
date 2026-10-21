// Package dbtest gives integration tests the test database (TEST_DATABASE_URL),
// never the development database.
package dbtest

import (
	"os"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/config"
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
