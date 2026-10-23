package daily

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Bernabass/chess-detective/services/api/internal/chessrules"
	"github.com/Bernabass/chess-detective/services/api/internal/clock"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
	"github.com/Bernabass/chess-detective/services/api/internal/store/sqlcdb"
)

// puzzleRecord is one line of the generator's JSONL output (SPEC §7.4).
type puzzleRecord struct {
	ID            string   `json:"id"`
	Plies         int      `json:"plies"`
	Target        string   `json:"target"`
	Solution      []string `json:"solution"`
	Features      []string `json:"features"`
	Difficulty    int      `json:"difficulty"`
	Score         float64  `json:"score"`
	SolverNodes   int64    `json:"solverNodes"`
	EngineVersion string   `json:"engineVersion"`
	Seed          int      `json:"seed"`
}

// ImportReport is what import-puzzles did.
type ImportReport struct {
	Inserted, Skipped int
}

// ImportPuzzles loads a generator JSONL file, idempotently (a puzzle already imported is
// skipped). Every solution is replayed: it must reach its target in exactly its plies, so a
// corrupt file can't load a puzzle the server would then judge wrongly. All or nothing.
func ImportPuzzles(ctx context.Context, st *store.Store, r io.Reader) (ImportReport, error) {
	var records []puzzleRecord
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		var rec puzzleRecord
		dec := json.NewDecoder(strings.NewReader(text))
		if err := dec.Decode(&rec); err != nil {
			return ImportReport{}, fmt.Errorf("line %d: %w", line, err)
		}
		if err := validateRecord(rec); err != nil {
			return ImportReport{}, fmt.Errorf("line %d (%s): %w", line, rec.ID, err)
		}
		records = append(records, rec)
	}
	if err := scanner.Err(); err != nil {
		return ImportReport{}, fmt.Errorf("reading puzzles: %w", err)
	}

	var report ImportReport
	err := st.InTx(ctx, func(q *sqlcdb.Queries) error {
		for _, rec := range records {
			n, err := q.InsertPuzzle(ctx, sqlcdb.InsertPuzzleParams{
				ExternalID:    rec.ID,
				Plies:         int32(rec.Plies), //nolint:gosec // validated 1..40
				Target:        rec.Target,
				Solution:      rec.Solution,
				Difficulty:    int16(rec.Difficulty), //nolint:gosec // validated 1..5
				Features:      nonNil(rec.Features),
				SolverNodes:   rec.SolverNodes,
				EngineVersion: rec.EngineVersion,
			})
			if err != nil {
				return fmt.Errorf("inserting %s: %w", rec.ID, err)
			}
			if n == 1 {
				report.Inserted++
			} else {
				report.Skipped++
			}
		}
		return nil
	})
	return report, err //nolint:wrapcheck // InTx wraps
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func validateRecord(rec puzzleRecord) error {
	switch {
	case rec.ID == "":
		return errors.New("missing id")
	case rec.Plies < 1 || rec.Plies > MaxMoves:
		return fmt.Errorf("plies %d out of range", rec.Plies)
	case len(rec.Solution) != rec.Plies:
		return fmt.Errorf("%d solution moves for %d plies", len(rec.Solution), rec.Plies)
	case rec.Difficulty < 1 || rec.Difficulty > 5:
		return fmt.Errorf("difficulty %d out of range", rec.Difficulty)
	case rec.EngineVersion == "":
		return errors.New("missing engineVersion")
	}
	res, err := chessrules.Replay(rec.Solution)
	if err != nil {
		return fmt.Errorf("solution doesn't replay: %w", err)
	}
	if res.TargetKey != rec.Target {
		return fmt.Errorf("solution reaches %q, not the target %q", res.TargetKey, rec.Target)
	}
	return nil
}

// Ramp is the weekly difficulty ramp (SPEC §8.7): ★ on Monday up to ★★★★★ on Sunday.
func Ramp(day time.Weekday) int {
	switch day {
	case time.Monday:
		return 1
	case time.Tuesday, time.Wednesday:
		return 2
	case time.Thursday, time.Friday:
		return 3
	case time.Saturday:
		return 4
	default: // Sunday
		return 5
	}
}

// ScheduleReport is what schedule did, and the pool left.
type ScheduleReport struct {
	Assigned, Kept int
	// Remaining unscheduled puzzles per difficulty (1..5).
	Remaining [6]int
}

// ErrPoolExhausted is returned when a level runs out; nothing is scheduled then.
var ErrPoolExhausted = errors.New("the puzzle pool ran out")

// Schedule assigns unscheduled puzzles to `days` days from `from` by the weekday ramp
// (deterministically: the lowest unscheduled id of the level). Days already scheduled are
// kept. Puzzle number = days since launch + 1, so nothing can be scheduled before launch.
// All or nothing: if a level runs out, no day is scheduled. The report's remaining counts are
// always filled in (after scheduling, or as they stand when it fails).
func Schedule(ctx context.Context, st *store.Store, launch, from time.Time, days int) (ScheduleReport, error) {
	launch, from = clock.Day(launch), clock.Day(from)
	var report ScheduleReport
	if from.Before(launch) {
		return report, fmt.Errorf("--from %s is before LAUNCH_DATE %s (puzzle #1)", from.Format(time.DateOnly), launch.Format(time.DateOnly))
	}
	if days < 1 {
		return report, errors.New("--days must be at least 1")
	}
	err := st.InTx(ctx, func(q *sqlcdb.Queries) error {
		for i := range days {
			day := from.AddDate(0, 0, i)
			if _, err := q.GetScheduledDay(ctx, day); err == nil {
				report.Kept++
				continue
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("checking %s: %w", day.Format(time.DateOnly), err)
			}
			level := Ramp(day.Weekday())
			id, err := q.NextUnscheduledPuzzle(ctx, int16(level)) //nolint:gosec // 1..5
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: no unscheduled %s puzzle left for %s (%s)", ErrPoolExhausted,
					strings.Repeat("★", level), day.Format(time.DateOnly), day.Weekday())
			}
			if err != nil {
				return fmt.Errorf("picking a puzzle for %s: %w", day.Format(time.DateOnly), err)
			}
			number := int(day.Sub(launch).Hours()/24) + 1
			if err := q.InsertSchedule(ctx, sqlcdb.InsertScheduleParams{Day: day, Number: int32(number), PuzzleID: id}); err != nil { //nolint:gosec // days since launch
				return fmt.Errorf("scheduling %s: %w", day.Format(time.DateOnly), err)
			}
			report.Assigned++
		}
		return nil
	})
	remaining, countErr := RemainingPool(ctx, st)
	report.Remaining = remaining
	if err != nil {
		return report, err //nolint:wrapcheck // InTx wraps
	}
	return report, countErr
}

// RemainingPool counts unscheduled puzzles per difficulty (index 1..5).
func RemainingPool(ctx context.Context, st *store.Store) ([6]int, error) {
	var out [6]int
	rows, err := st.Queries().CountUnscheduledByDifficulty(ctx)
	if err != nil {
		return out, fmt.Errorf("counting the pool: %w", err)
	}
	for _, r := range rows {
		if r.Difficulty >= 1 && r.Difficulty <= 5 {
			out[r.Difficulty] = int(r.Remaining)
		}
	}
	return out, nil
}

// ArchiveItem is one past puzzle, with the caller's result if they have one.
type ArchiveItem struct {
	Number, Plies, Difficulty int
	Day                       time.Time
	Result                    *ArchiveResult
}

// ArchiveResult is a player's result on an archive item.
type ArchiveResult struct {
	Status         string
	Guesses, Hints int
}

// ArchivePageSize is the number of puzzles per archive page.
const ArchivePageSize = 30

// Archive lists released puzzles, newest first (today's included), 30 per page.
func (s *Service) Archive(ctx context.Context, page int, playerID int64) ([]ArchiveItem, int, error) {
	q := s.Store.Queries()
	today := s.today()
	total, err := q.CountArchive(ctx, today)
	if err != nil {
		return nil, 0, fmt.Errorf("counting archive: %w", err)
	}
	rows, err := q.ListArchive(ctx, sqlcdb.ListArchiveParams{
		PlayerID: playerID, Today: today, PageSize: ArchivePageSize, PageOffset: int32((page - 1) * ArchivePageSize), //nolint:gosec // page ≤ 10000
	})
	if err != nil {
		return nil, 0, fmt.Errorf("listing archive: %w", err)
	}
	items := make([]ArchiveItem, len(rows))
	for i, r := range rows {
		items[i] = ArchiveItem{Number: int(r.Number), Day: r.Day, Difficulty: int(r.Difficulty), Plies: int(r.Plies)}
		if r.ResultStatus != nil {
			hints := 0
			if r.ResultHints != nil {
				hints = int(*r.ResultHints)
			}
			items[i].Result = &ArchiveResult{Status: string(*r.ResultStatus), Guesses: int(r.ResultGuesses), Hints: hints}
		}
	}
	return items, int(total), nil
}
