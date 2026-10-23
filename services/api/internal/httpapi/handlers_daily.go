package httpapi

import (
	"context"
	"strconv"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/Bernabass/chess-detective/services/api/internal/daily"
)

// GetToday returns today's puzzle. It creates nothing.
func (s *Server) GetToday(ctx context.Context, _ GetTodayRequestObject) (GetTodayResponseObject, error) {
	p, err := s.daily.Get(ctx, 0, playerID(ctx))
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	return GetToday200JSONResponse(toPuzzle(p)), nil
}

// GetPuzzle returns puzzle `number` (today's or earlier). It creates nothing.
func (s *Server) GetPuzzle(ctx context.Context, req GetPuzzleRequestObject) (GetPuzzleResponseObject, error) {
	p, err := s.daily.Get(ctx, req.Number, playerID(ctx))
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	return GetPuzzle200JSONResponse(toPuzzle(p)), nil
}

// StartPuzzle creates the guest session if needed and the attempt (idempotent).
func (s *Server) StartPuzzle(ctx context.Context, req StartPuzzleRequestObject) (StartPuzzleResponseObject, error) {
	if err := limit(s.limits.StartPerIP, stateOf(ctx).ip.String()); err != nil {
		return nil, err
	}
	if _, err := s.daily.Get(ctx, req.Number, 0); err != nil {
		return nil, err //nolint:wrapcheck // no guest for a puzzle that doesn't exist
	}
	sess, err := s.ensureSession(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.daily.Start(ctx, req.Number, sess.PlayerID)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	return StartPuzzle200JSONResponse(toPuzzle(p)), nil
}

// SubmitGuess records a guess (SPEC §10.5).
func (s *Server) SubmitGuess(ctx context.Context, req SubmitGuessRequestObject) (SubmitGuessResponseObject, error) {
	id := playerID(ctx)
	if id == 0 {
		return nil, errNoSession
	}
	if err := limit(s.limits.PlayPerPlayer, strconv.FormatInt(id, 10)); err != nil {
		return nil, err
	}
	r, err := s.daily.Guess(ctx, req.Number, id, req.Body.Moves)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	out := GuessResult{Feedback: r.Feedback, Status: AttemptStatus(r.Status), GuessesUsed: r.GuessesUsed}
	if r.Solution != nil {
		out.Solution = &r.Solution
	}
	return SubmitGuess200JSONResponse(out), nil
}

// TakeHint serves the next hint.
func (s *Server) TakeHint(ctx context.Context, req TakeHintRequestObject) (TakeHintResponseObject, error) {
	id := playerID(ctx)
	if id == 0 {
		return nil, errNoSession
	}
	if err := limit(s.limits.PlayPerPlayer, strconv.FormatInt(id, 10)); err != nil {
		return nil, err
	}
	r, err := s.daily.Hint(ctx, req.Number, id)
	if err != nil {
		return nil, err //nolint:wrapcheck // domain errors are mapped in writeError
	}
	return TakeHint200JSONResponse(HintResult{HintIndex: r.Index, Hint: toHint(r.Hint)}), nil
}

func toPuzzle(p daily.Puzzle) Puzzle {
	out := Puzzle{
		Number:     p.Number,
		Day:        openapi_types.Date{Time: p.Day},
		Plies:      p.Plies,
		Target:     p.Target,
		Difficulty: p.Difficulty,
	}
	if p.Solution != nil { // only for finished attempts (daily.Service guarantees it)
		solution := p.Solution
		out.Solution = &solution
	}
	if a := p.Attempt; a != nil {
		guesses := make([]Guess, len(a.Guesses))
		for i, g := range a.Guesses {
			guesses[i] = Guess{Moves: g.Moves, Feedback: g.Feedback}
		}
		hints := make([]Hint, len(a.Hints))
		for i, h := range a.Hints {
			hints[i] = toHint(h)
		}
		out.Attempt = &Attempt{
			Status:     AttemptStatus(a.Status),
			Archive:    a.Archive,
			Guesses:    guesses,
			HintsUsed:  a.HintsUsed,
			Hints:      hints,
			StartedAt:  a.StartedAt,
			FinishedAt: a.FinishedAt,
		}
	}
	return out
}

func toHint(h daily.Hint) Hint {
	out := Hint{Kind: HintKind(h.Kind), Text: h.Text}
	switch h.Kind {
	case daily.HintMovers:
		white, black := h.White, h.Black
		out.White, out.Black = &white, &black
	case daily.HintCaptures:
		plies := h.Plies
		out.Plies = &plies
	case daily.HintMove:
		ply, uci, san := h.Ply, h.UCI, h.SAN
		out.Ply, out.Uci, out.San = &ply, &uci, &san
	}
	return out
}
