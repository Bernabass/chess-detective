package ratelimit_test

import (
	"testing"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/ratelimit"
)

func TestLimiter(t *testing.T) {
	c := clock.NewFake(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC))
	l := ratelimit.New(c, 3, time.Minute)
	for i := range 3 {
		if ok, _ := l.Allow("ip-1"); !ok {
			t.Fatalf("event %d refused", i+1)
		}
	}
	ok, wait := l.Allow("ip-1")
	if ok || wait <= 0 || wait > 20*time.Second {
		t.Errorf("4th event: ok=%v wait=%v, want refused with about 20 s to wait", ok, wait)
	}
	if ok, _ := l.Allow("ip-2"); !ok {
		t.Error("keys are independent")
	}
	c.Advance(20 * time.Second)
	if ok, _ := l.Allow("ip-1"); !ok {
		t.Error("one token refills every 20 s")
	}
	c.Advance(time.Hour)
	for i := range 3 {
		if ok, _ := l.Allow("ip-1"); !ok {
			t.Fatalf("after a long pause, event %d refused (bucket should be full)", i+1)
		}
	}
}
