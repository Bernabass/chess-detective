// Package clock gives domain code the time through an interface, so day boundaries and
// streaks are testable (domain code never calls time.Now directly).
package clock

import (
	"sync"
	"time"
)

// Clock tells the current time.
type Clock interface {
	Now() time.Time
}

// Real is the system clock, in UTC.
type Real struct{}

// Now returns the current UTC time.
func (Real) Now() time.Time { return time.Now().UTC() }

// Fake is a settable clock for tests. The zero value is not usable; use NewFake.
type Fake struct {
	mu sync.Mutex
	t  time.Time
}

// NewFake returns a clock stopped at t.
func NewFake(t time.Time) *Fake { return &Fake{t: t.UTC()} }

// Now returns the fake time.
func (f *Fake) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

// Set moves the clock to t.
func (f *Fake) Set(t time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = t.UTC()
}

// Advance moves the clock forward by d.
func (f *Fake) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

// Day is t's UTC calendar date at midnight: the unit of the daily puzzle.
func Day(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
