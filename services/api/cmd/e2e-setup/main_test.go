package main

import (
	"strings"
	"testing"
)

func TestSchemaURLOnlyForTestDatabases(t *testing.T) {
	got, err := SchemaURL("postgres://u:p@localhost:5432/retrograde_test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "/retrograde_test?") || !strings.Contains(got, "search_path=e2e%2Cpublic") ||
		!strings.Contains(got, "sslmode=disable") {
		t.Errorf("SchemaURL = %q", got)
	}
	for _, bad := range []string{
		"postgres://u:p@localhost:5432/retrograde?sslmode=disable",
		"postgres://u:p@localhost:5432/test_retrograde",
		"postgres://u:p@localhost:5432/",
	} {
		if _, err := SchemaURL(bad); err == nil || !strings.Contains(err.Error(), "_test") {
			t.Errorf("SchemaURL(%q): err = %v, want a refusal", bad, err)
		}
	}
}
