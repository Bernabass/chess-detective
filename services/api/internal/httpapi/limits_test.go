package httpapi

import (
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
)

func TestDefaultLimitsScale(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC))
	for _, scale := range []int{1, 3} {
		l := DefaultLimits(clk, scale)
		allowed := 0
		for range 100 {
			if ok, _ := l.AuthPerIP.Allow("1.2.3.4"); ok {
				allowed++
			}
		}
		if allowed != 10*scale {
			t.Errorf("scale %d: %d logins allowed per minute, want %d", scale, allowed, 10*scale)
		}
	}
}
