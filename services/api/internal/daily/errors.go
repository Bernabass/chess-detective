package daily

import (
	"errors"
	"fmt"
)

// Domain errors; internal/httpapi maps them to HTTP statuses in one place.
var (
	ErrPuzzleNotFound = errors.New("no such puzzle (or not yet released)")
	ErrNotStarted     = errors.New("this puzzle hasn't been started: call POST /api/daily/{number}/start first")
	ErrFinished       = errors.New("this attempt is already finished")
	ErrNoGuessesLeft  = errors.New("all six guesses are used")
	ErrHintsUsedUp    = errors.New("all three hints are used")
	ErrTooManyMoves   = fmt.Errorf("a guess has at most %d moves", MaxMoves)
)

// MaxMoves bounds a guess before anything is looked up (SPEC §10.5).
const MaxMoves = 40

// InvalidGuessError is a guess of the wrong length or with an illegal or malformed move.
type InvalidGuessError struct {
	Ply    int // 1-based ply of the bad move (like hint plies), or 0 when the length is wrong
	Reason string
}

func (e *InvalidGuessError) Error() string { return e.Reason }
