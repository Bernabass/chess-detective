package daily

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/chessrules"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// Attempt statuses (the attempt_status enum).
const (
	StatusInProgress = string(sqlcdb.AttemptStatusInProgress)
	StatusSolved     = string(sqlcdb.AttemptStatusSolved)
	StatusFailed     = string(sqlcdb.AttemptStatusFailed)
)

// Puzzle is a daily puzzle as a player sees it. Solution is set only when their attempt is
// finished: the solution never leaves the server before that.
type Puzzle struct {
	Number     int
	Day        time.Time
	Plies      int
	Target     string
	Difficulty int
	Attempt    *Attempt
	Solution   []string
}

// Attempt is a player's attempt at a puzzle.
type Attempt struct {
	Status     string
	Archive    bool
	Guesses    []Guess
	HintsUsed  int
	Hints      []Hint
	StartedAt  time.Time
	FinishedAt *time.Time
}

// Guess is one submitted guess and its feedback.
type Guess struct {
	Moves    []string
	Feedback string
}

// GuessResult is the outcome of submitting a guess.
type GuessResult struct {
	Feedback    string
	Status      string
	GuessesUsed int
	Solution    []string // only when this guess finished the attempt
}

// HintResult is a hint taken.
type HintResult struct {
	Index int // 1..3
	Hint  Hint
}

// Service applies the daily rules in database transactions.
type Service struct {
	Store *store.Store
	Clock clock.Clock
}

func (s *Service) today() time.Time { return clock.Day(s.Clock.Now()) }

type puzzleRow struct {
	number     int
	day        time.Time
	id         int64
	plies      int
	target     string
	difficulty int
	solution   []string
}

// lookup finds a released puzzle: number 0 means today's.
func (s *Service) lookup(ctx context.Context, q *sqlcdb.Queries, number int) (puzzleRow, error) {
	today := s.today()
	var r puzzleRow
	if number == 0 {
		row, err := q.GetDailyByDay(ctx, today)
		if err != nil {
			return r, notFound(err)
		}
		return puzzleRow{int(row.Number), row.Day, row.PuzzleID, int(row.Plies), row.Target, int(row.Difficulty), row.Solution}, nil
	}
	row, err := q.GetDailyByNumber(ctx, int32(number)) //nolint:gosec // bounded by the API contract (1..100000)
	if err != nil {
		return r, notFound(err)
	}
	if row.Day.After(today) {
		return r, ErrPuzzleNotFound // a future puzzle doesn't exist yet as far as players know
	}
	return puzzleRow{int(row.Number), row.Day, row.PuzzleID, int(row.Plies), row.Target, int(row.Difficulty), row.Solution}, nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPuzzleNotFound
	}
	return fmt.Errorf("looking up puzzle: %w", err)
}

// Get returns puzzle `number` (0 = today's) with the player's attempt, if any. It creates
// nothing (GETs are side-effect free; DECISIONS 2026-10-23). playerID 0 means no session.
func (s *Service) Get(ctx context.Context, number int, playerID int64) (Puzzle, error) {
	q := s.Store.Queries()
	p, err := s.lookup(ctx, q, number)
	if err != nil {
		return Puzzle{}, err
	}
	return s.view(ctx, q, p, playerID)
}

// Start creates the player's attempt (idempotently: the first start time stays) and returns
// the puzzle with it. An attempt started after the puzzle's day is an archive attempt, fixed
// here for good (SPEC §10.5).
func (s *Service) Start(ctx context.Context, number int, playerID int64) (Puzzle, error) {
	var out Puzzle
	err := s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		p, err := s.lookup(ctx, q, number)
		if err != nil {
			return err
		}
		if err := q.CreateAttempt(ctx, sqlcdb.CreateAttemptParams{
			PlayerID:  playerID,
			PuzzleID:  p.id,
			IsArchive: p.day.Before(s.today()),
			StartedAt: s.Clock.Now(),
		}); err != nil {
			return fmt.Errorf("creating attempt: %w", err)
		}
		out, err = s.view(ctx, q, p, playerID)
		return err
	})
	return out, err //nolint:wrapcheck // domain errors pass through unchanged
}

func (s *Service) view(ctx context.Context, q *sqlcdb.Queries, p puzzleRow, playerID int64) (Puzzle, error) {
	out := Puzzle{Number: p.number, Day: p.day, Plies: p.plies, Target: p.target, Difficulty: p.difficulty}
	if playerID == 0 {
		return out, nil
	}
	a, err := q.GetAttempt(ctx, sqlcdb.GetAttemptParams{PlayerID: playerID, PuzzleID: p.id})
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, fmt.Errorf("loading attempt: %w", err)
	}
	rows, err := q.ListGuesses(ctx, a.ID)
	if err != nil {
		return out, fmt.Errorf("loading guesses: %w", err)
	}
	solution, err := chessrules.Replay(p.solution)
	if err != nil {
		return out, fmt.Errorf("replaying the stored solution of puzzle %d: %w", p.number, err)
	}
	guesses := make([]Guess, len(rows))
	for i, g := range rows {
		guesses[i] = Guess{Moves: g.Moves, Feedback: g.Feedback}
	}
	movePly := 0
	if a.HintMovePly != nil {
		movePly = int(*a.HintMovePly)
	}
	out.Attempt = &Attempt{
		Status:     string(a.Status),
		Archive:    a.IsArchive,
		Guesses:    guesses,
		HintsUsed:  int(a.HintsUsed),
		Hints:      Hints(solution, int(a.HintsUsed), movePly),
		StartedAt:  a.StartedAt,
		FinishedAt: a.FinishedAt,
	}
	if a.Status != sqlcdb.AttemptStatusInProgress {
		out.Solution = p.solution
	}
	return out, nil
}

// Guess submits a guess (SPEC §10.5), in one transaction with the attempt row locked, so two
// simultaneous guesses on one attempt are serialized.
func (s *Service) Guess(ctx context.Context, number int, playerID int64, moves []string) (GuessResult, error) {
	if len(moves) > MaxMoves {
		return GuessResult{}, ErrTooManyMoves
	}
	var out GuessResult
	err := s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		p, err := s.lookup(ctx, q, number)
		if err != nil {
			return err
		}
		a, err := q.LockAttempt(ctx, sqlcdb.LockAttemptParams{PlayerID: playerID, PuzzleID: p.id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotStarted
		}
		if err != nil {
			return fmt.Errorf("locking attempt: %w", err)
		}
		if a.Status != sqlcdb.AttemptStatusInProgress {
			return ErrFinished
		}
		previous, err := q.ListGuesses(ctx, a.ID)
		if err != nil {
			return fmt.Errorf("loading guesses: %w", err)
		}
		if len(previous) >= MaxGuesses {
			return ErrNoGuessesLeft
		}
		if len(moves) != p.plies {
			return &InvalidGuessError{Reason: fmt.Sprintf("a guess has exactly %d moves; this one has %d", p.plies, len(moves))}
		}
		played, err := chessrules.Replay(moves)
		var illegal *chessrules.IllegalMoveError
		if errors.As(err, &illegal) {
			return &InvalidGuessError{Ply: illegal.Ply + 1, Reason: illegal.Error()}
		}
		if err != nil {
			return fmt.Errorf("replaying guess: %w", err)
		}

		now := s.Clock.Now()
		feedback := Feedback(p.solution, moves)
		if err := q.InsertGuess(ctx, sqlcdb.InsertGuessParams{
			AttemptID: a.ID, Idx: int16(len(previous)), Moves: moves, Feedback: feedback, CreatedAt: now, //nolint:gosec // at most 5
		}); err != nil {
			return fmt.Errorf("saving guess: %w", err)
		}
		out = GuessResult{Feedback: feedback, Status: StatusInProgress, GuessesUsed: len(previous) + 1}
		solved := played.TargetKey == p.target
		if !solved && out.GuessesUsed < MaxGuesses {
			return nil
		}
		status := sqlcdb.AttemptStatusFailed
		if solved {
			status = sqlcdb.AttemptStatusSolved
		}
		if err := q.FinishAttempt(ctx, sqlcdb.FinishAttemptParams{ID: a.ID, Status: status, FinishedAt: &now}); err != nil {
			return fmt.Errorf("finishing attempt: %w", err)
		}
		out.Status = string(status)
		out.Solution = p.solution
		if a.IsArchive {
			return nil // practice: no stats, streaks or leaderboards
		}
		return RecomputeStats(ctx, q, playerID)
	})
	return out, err //nolint:wrapcheck // domain errors pass through unchanged
}

// Hint takes the next hint (SPEC §8.4). Hint 3's ply is stored, so it stays the same.
func (s *Service) Hint(ctx context.Context, number int, playerID int64) (HintResult, error) {
	var out HintResult
	err := s.Store.InTx(ctx, func(q *sqlcdb.Queries) error {
		p, err := s.lookup(ctx, q, number)
		if err != nil {
			return err
		}
		a, err := q.LockAttempt(ctx, sqlcdb.LockAttemptParams{PlayerID: playerID, PuzzleID: p.id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotStarted
		}
		if err != nil {
			return fmt.Errorf("locking attempt: %w", err)
		}
		if a.Status != sqlcdb.AttemptStatusInProgress {
			return ErrFinished
		}
		if int(a.HintsUsed) >= MaxHints {
			return ErrHintsUsedUp
		}
		solution, err := chessrules.Replay(p.solution)
		if err != nil {
			return fmt.Errorf("replaying the stored solution of puzzle %d: %w", p.number, err)
		}
		index := int(a.HintsUsed) + 1
		var movePly *int16
		switch index {
		case 1:
			out = HintResult{Index: 1, Hint: MoversHint(solution)}
		case 2:
			out = HintResult{Index: 2, Hint: CapturesHint(solution)}
		default:
			guesses, err := q.ListGuesses(ctx, a.ID)
			if err != nil {
				return fmt.Errorf("loading guesses: %w", err)
			}
			latest := ""
			if len(guesses) > 0 {
				latest = guesses[len(guesses)-1].Feedback
			}
			ply := MovePly(latest)
			stored := int16(ply) //nolint:gosec // at most 40
			movePly = &stored
			out = HintResult{Index: 3, Hint: MoveHint(solution, ply)}
		}
		if err := q.SetHintsUsed(ctx, sqlcdb.SetHintsUsedParams{
			ID: a.ID, HintsUsed: int16(index), HintMovePly: movePly, //nolint:gosec // 1..3
		}); err != nil {
			return fmt.Errorf("saving hint: %w", err)
		}
		return nil
	})
	return out, err //nolint:wrapcheck // domain errors pass through unchanged
}

// RecomputeStats rebuilds a player's stats from their finished daily attempts. One code path
// for both a finished attempt and a guest merge, so the two can't drift.
func RecomputeStats(ctx context.Context, q *sqlcdb.Queries, playerID int64) error {
	rows, err := q.ListFinishedDailyAttempts(ctx, playerID)
	if err != nil {
		return fmt.Errorf("loading attempts for stats: %w", err)
	}
	attempts := make([]FinishedAttempt, len(rows))
	for i, r := range rows {
		attempts[i] = FinishedAttempt{
			Day: r.Day, Solved: r.Status == sqlcdb.AttemptStatusSolved, Guesses: int(r.Guesses), Hints: int(r.HintsUsed),
		}
	}
	st := ComputeStats(attempts)
	dist := make([]int32, len(st.GuessDist))
	for i, n := range st.GuessDist {
		dist[i] = int32(n) //nolint:gosec // counts of attempts
	}
	if err := q.UpsertStats(ctx, sqlcdb.UpsertStatsParams{
		PlayerID:      playerID,
		Played:        int32(st.Played),        //nolint:gosec // counts of attempts
		Solved:        int32(st.Solved),        //nolint:gosec
		CurrentStreak: int32(st.CurrentStreak), //nolint:gosec
		MaxStreak:     int32(st.MaxStreak),     //nolint:gosec
		LastSolvedDay: st.LastSolvedDay,
		GuessDist:     dist,
		HintsTotal:    int32(st.HintsTotal), //nolint:gosec
	}); err != nil {
		return fmt.Errorf("saving stats: %w", err)
	}
	return nil
}

// PlayerStats is a player's stats as displayed, with the current streak as of today.
type PlayerStats struct {
	Played, Solved, CurrentStreak, MaxStreak, HintsTotal int
	GuessDist                                            [7]int
}

// StatsFor loads a player's stats (all zero if they have none yet).
func StatsFor(ctx context.Context, q *sqlcdb.Queries, playerID int64, today time.Time) (PlayerStats, error) {
	var out PlayerStats
	row, err := q.GetStats(ctx, playerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, fmt.Errorf("loading stats: %w", err)
	}
	out = PlayerStats{
		Played:        int(row.Played),
		Solved:        int(row.Solved),
		CurrentStreak: CurrentStreakOn(int(row.CurrentStreak), row.LastSolvedDay, clock.Day(today)),
		MaxStreak:     int(row.MaxStreak),
		HintsTotal:    int(row.HintsTotal),
	}
	for i := range out.GuessDist {
		if i < len(row.GuessDist) {
			out.GuessDist[i] = int(row.GuessDist[i])
		}
	}
	return out, nil
}
