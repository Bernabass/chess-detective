package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
	"github.com/Bernabass/chess-detective/services/api/internal/daily"
	"github.com/Bernabass/chess-detective/services/api/internal/leaderboard"
)

// problem is an RFC 9457 problem details body.
type problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
	Ply    *int   `json:"ply,omitempty"`
}

// writeProblem sends an application/problem+json error. detail must never contain internal error text.
func writeProblem(w http.ResponseWriter, status int, detail string) {
	writeProblemBody(w, problem{Type: "about:blank", Title: http.StatusText(status), Status: status, Detail: detail})
}

func writeProblemBody(w http.ResponseWriter, p problem) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

// tooManyRequests is a rate-limit refusal.
type tooManyRequests struct {
	retryAfter time.Duration
}

func (e *tooManyRequests) Error() string {
	return fmt.Sprintf("too many requests: retry after %s", e.retryAfter)
}

// errNoSession is a request that needs a session but has none.
var errNoSession = errors.New("no session")

// writeError maps a handler's error to a problem response with a sentence fit for the UI: the one
// place domain errors become HTTP statuses. Unknown errors are logged and sent as a bare 500
// (no internal details).
func writeError(logger *slog.Logger, w http.ResponseWriter, r *http.Request, err error) {
	var invalid *daily.InvalidGuessError
	var limited *tooManyRequests
	switch {
	case errors.Is(err, daily.ErrPuzzleNotFound):
		writeProblem(w, http.StatusNotFound, "There's no puzzle with that number yet.")
	case errors.Is(err, daily.ErrNotStarted), errors.Is(err, errNoSession):
		writeProblem(w, http.StatusConflict, "This puzzle hasn't been started. Reload the page (API clients: POST /api/daily/{number}/start first).")
	case errors.Is(err, daily.ErrFinished):
		writeProblem(w, http.StatusConflict, "This puzzle is already finished.")
	case errors.Is(err, daily.ErrNoGuessesLeft):
		writeProblem(w, http.StatusConflict, "All six guesses are used.")
	case errors.Is(err, daily.ErrHintsUsedUp):
		writeProblem(w, http.StatusConflict, "All three hints are used.")
	case errors.Is(err, daily.ErrTooManyMoves):
		writeProblem(w, http.StatusBadRequest, fmt.Sprintf("A guess has at most %d moves.", daily.MaxMoves))
	case errors.As(err, &invalid):
		p := problem{Type: "about:blank", Title: "Invalid guess", Status: http.StatusUnprocessableEntity, Detail: invalid.Reason}
		if invalid.Ply > 0 {
			ply := invalid.Ply
			p.Ply = &ply
		}
		writeProblemBody(w, p)
	case errors.Is(err, auth.ErrUsernameTaken):
		writeProblem(w, http.StatusConflict, "That username is taken. Pick another one.")
	case errors.Is(err, auth.ErrBadCredentials):
		writeProblem(w, http.StatusUnauthorized, "Wrong username or password.")
	case errors.Is(err, leaderboard.ErrUserNotFound):
		writeProblem(w, http.StatusNotFound, "There's no player with that name.")
	case errors.As(err, &limited):
		seconds := int(math.Ceil(limited.retryAfter.Seconds()))
		w.Header().Set("Retry-After", strconv.Itoa(max(1, seconds)))
		writeProblem(w, http.StatusTooManyRequests, "Too many requests. Try again in a little while.")
	default:
		logger.ErrorContext(r.Context(), "handler failed", "err", err)
		writeProblem(w, http.StatusInternalServerError, "")
	}
}
