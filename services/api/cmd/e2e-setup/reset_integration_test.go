//go:build integration

package main

import (
	"net/url"
	"strings"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
)

// The URL's path can say *_test while ?dbname= (which pgx honours) points elsewhere: the reset
// must check the database it actually connected to, and touch nothing there.
func TestResetRefusesADatabaseNotEndingInTest(t *testing.T) {
	u, err := url.Parse(dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("dbname", "postgres") // exists in every PostgreSQL installation
	u.RawQuery = q.Encode()
	if _, err := SchemaURL(u.String()); err != nil {
		t.Fatalf("the path still ends in _test, so SchemaURL accepts it: %v", err)
	}
	err = resetSchema(t.Context(), u.String())
	if err == nil || !strings.Contains(err.Error(), `refusing to touch database "postgres"`) {
		t.Fatalf("resetSchema = %v, want a refusal", err)
	}
}
