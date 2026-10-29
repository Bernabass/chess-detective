package httpapi

import (
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/ratelimit"
)

// allowedPerBurst counts how many events a fresh limiter lets through at one instant.
func allowedPerBurst(l *ratelimit.Limiter) int {
	allowed := 0
	for range 10_000 {
		if ok, _ := l.Allow("1.2.3.4"); ok {
			allowed++
		}
	}
	return allowed
}

func TestDefaultLimits(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC))
	for _, scale := range []int{1, 3} {
		l := DefaultLimits(clk, scale)
		for _, c := range []struct {
			name    string
			limiter *ratelimit.Limiter
			want    int
		}{
			// Per IP: generous, because many real users share one (carrier NAT, campus networks).
			{"login/register per IP", l.AuthPerIP, 60},
			{"Lichess sign-in start per IP", l.OAuthStartPerIP, 60},
			{"puzzle start per IP", l.StartPerIP, 300},
			// Per username: this is what stops password guessing.
			{"login per username", l.AuthPerUsername, 10},
			{"guesses and hints per player", l.PlayPerPlayer, 30},
		} {
			if got := allowedPerBurst(c.limiter); got != c.want*scale {
				t.Errorf("scale %d, %s: %d allowed at once, want %d", scale, c.name, got, c.want*scale)
			}
		}
	}
}
