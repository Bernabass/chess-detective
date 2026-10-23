// Package ratelimit is an in-memory token-bucket rate limiter (SPEC §10.6). Limiters are
// created by the server and injected; there is no global state.
package ratelimit

import (
	"sync"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/clock"
)

// Limiter allows `burst` events per key per `period`, refilling continuously.
type Limiter struct {
	clock  clock.Clock
	burst  float64
	period time.Duration

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastPrune time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

// New returns a limiter of `burst` events per `period` per key.
func New(c clock.Clock, burst int, period time.Duration) *Limiter {
	return &Limiter{clock: c, burst: float64(burst), period: period, buckets: map[string]*bucket{}}
}

// Allow takes one event for key. If none is left, it reports how long until one is.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.clock.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(now)

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, at: now}
		l.buckets[key] = b
	}
	rate := l.burst / l.period.Seconds() // tokens per second
	b.tokens = min(l.burst, b.tokens+now.Sub(b.at).Seconds()*rate)
	b.at = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration((1 - b.tokens) / rate * float64(time.Second))
	return false, wait
}

// prune drops buckets that have refilled completely (once per period), so memory stays bounded
// by the number of active keys.
func (l *Limiter) prune(now time.Time) {
	if now.Sub(l.lastPrune) < l.period {
		return
	}
	l.lastPrune = now
	for k, b := range l.buckets {
		if now.Sub(b.at) >= l.period {
			delete(l.buckets, k)
		}
	}
}
