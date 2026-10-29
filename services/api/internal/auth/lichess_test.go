package auth

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

func TestUsernameCandidates(t *testing.T) {
	for _, c := range []struct {
		lichess string
		want    []string
	}{
		{"Thibault", []string{"Thibault", "Thibault-2", "Thibault-3"}},
		// Lichess allows 2-letter names; ours start at 3.
		{"ab", []string{"ab-2", "ab-3", "ab-4"}},
		// 20 characters: the suffix replaces the end.
		{"abcdefghijklmnopqrst", []string{"abcdefghijklmnopqrst", "abcdefghijklmnopqr-2", "abcdefghijklmnopqr-3"}},
		// Anything outside [A-Za-z0-9_-] is dropped.
		{"jo.hn!", []string{"john", "john-2", "john-3"}},
		{"..", []string{"player", "player-2", "player-3"}},
	} {
		got := usernameCandidates(c.lichess, 3)
		if fmt.Sprint(got) != fmt.Sprint(c.want) {
			t.Errorf("usernameCandidates(%q) = %v, want %v", c.lichess, got, c.want)
		}
	}
	// Two-digit suffixes still fit.
	long := usernameCandidates("abcdefghijklmnopqrst", 12)
	if last := long[11]; last != "abcdefghijklmnopq-12" || len(last) != 20 {
		t.Errorf("12th candidate = %q", last)
	}
	for _, name := range long {
		if len(name) < 3 || len(name) > 20 || strings.Trim(name, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != "" {
			t.Errorf("invalid username %q", name)
		}
	}
}

func TestRandomUsername(t *testing.T) {
	seen := map[string]bool{}
	for range 20 {
		name, err := randomUsername("abcdefghijklmnopqrst")
		if err != nil {
			t.Fatal(err)
		}
		if len(name) != 20 || !strings.HasPrefix(name, "abcdefghijklm-") || strings.Trim(name[14:], "0123456789") != "" {
			t.Fatalf("randomUsername = %q", name)
		}
		seen[name] = true
	}
	if len(seen) < 15 {
		t.Errorf("only %d different names in 20", len(seen))
	}
	if name, _ := randomUsername("ab"); !regexp.MustCompile(`^ab-[0-9]{6}$`).MatchString(name) {
		t.Errorf("randomUsername(ab) = %q", name)
	}
}

func TestSafeReturnTo(t *testing.T) {
	for in, want := range map[string]string{
		"/daily/3":                     "/daily/3",
		"/leaderboard?view=x":          "/leaderboard?view=x",
		"":                             "/daily",
		"daily":                        "/daily",
		"https://evil.example":         "/daily",
		"//evil.example":               "/daily",
		"/\\evil.example":              "/daily",
		"/\tevil":                      "/daily",
		"/" + strings.Repeat("a", 600): "/daily",
	} {
		if got := SafeReturnTo(in); got != want {
			t.Errorf("SafeReturnTo(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLichessReason(t *testing.T) {
	for err, want := range map[error]string{
		ErrLichessCancelled:                        "cancelled",
		fmt.Errorf("%w: expired", ErrLichessState): "expired",
		fmt.Errorf("%w: token", ErrLichessFailed):  "failed",
		errors.New("database down"):                "failed",
	} {
		if got := LichessReason(err); got != want {
			t.Errorf("LichessReason(%v) = %q, want %q", err, got, want)
		}
	}
}

func TestLichessUserCaused(t *testing.T) {
	for err, want := range map[error]bool{
		ErrLichessCancelled:                                          true,
		fmt.Errorf("%w: expired", ErrLichessState):                   true,
		ErrLichessBadCallback:                                        true,
		fmt.Errorf("%w: token", ErrLichessFailed):                    false,
		fmt.Errorf("%w: lichess answered %q", ErrLichessFailed, "x"): false,
		fmt.Errorf("transaction: %w", errors.New("column missing")):  false,
	} {
		if got := LichessUserCaused(err); got != want {
			t.Errorf("LichessUserCaused(%v) = %v, want %v", err, got, want)
		}
	}
	if LichessReason(ErrLichessBadCallback) != "failed" {
		t.Error("a callback without a code should still show the generic failure")
	}
}
