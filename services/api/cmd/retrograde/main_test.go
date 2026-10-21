package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunRejectsUnknownCommands(t *testing.T) {
	for _, args := range [][]string{nil, {"bogus"}, {"serve", "extra"}} {
		var stdout, stderr bytes.Buffer
		if code := run(t.Context(), args, &stdout, &stderr); code != 2 {
			t.Errorf("run(%q) = %d, want 2", args, code)
		}
		if !strings.Contains(stderr.String(), "Usage: retrograde") {
			t.Errorf("run(%q) should print usage, got %q", args, stderr.String())
		}
	}
}

func TestMigrateWithoutDatabaseURLExplainsTheFix(t *testing.T) {
	t.Chdir(t.TempDir()) // no .env above a temp dir
	t.Setenv("DATABASE_URL", "")

	var stdout, stderr bytes.Buffer
	if code := run(t.Context(), []string{"migrate"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "copy .env.example to .env") {
		t.Errorf("stderr = %q, want a hint about .env", stderr.String())
	}
}
