-- Puzzles and the daily schedule (SPEC §8.7, §10.1).

-- name: InsertPuzzle :execrows
-- Idempotent import: a puzzle already imported (same external id) is skipped.
INSERT INTO puzzles (external_id, plies, target, solution, difficulty, features, solver_nodes, engine_version)
VALUES (@external_id, @plies, @target, @solution, @difficulty, @features, @solver_nodes, @engine_version)
ON CONFLICT (external_id) DO NOTHING;

-- name: CountUnscheduledByDifficulty :many
SELECT p.difficulty, count(*)::int AS remaining
FROM puzzles p
WHERE NOT EXISTS (SELECT 1 FROM daily_schedule s WHERE s.puzzle_id = p.id)
GROUP BY p.difficulty
ORDER BY p.difficulty;

-- name: NextUnscheduledPuzzle :one
-- Deterministic choice: the lowest unscheduled id of a difficulty.
SELECT p.id
FROM puzzles p
WHERE p.difficulty = @difficulty
  AND NOT EXISTS (SELECT 1 FROM daily_schedule s WHERE s.puzzle_id = p.id)
ORDER BY p.id
LIMIT 1;

-- name: GetScheduledDay :one
SELECT day, number, puzzle_id FROM daily_schedule WHERE day = @day;

-- name: InsertSchedule :exec
INSERT INTO daily_schedule (day, number, puzzle_id) VALUES (@day, @number, @puzzle_id);

-- name: GetDailyByNumber :one
SELECT s.number, s.day, p.id AS puzzle_id, p.plies, p.target, p.difficulty, p.solution
FROM daily_schedule s
JOIN puzzles p ON p.id = s.puzzle_id
WHERE s.number = @number;

-- name: GetDailyByDay :one
SELECT s.number, s.day, p.id AS puzzle_id, p.plies, p.target, p.difficulty, p.solution
FROM daily_schedule s
JOIN puzzles p ON p.id = s.puzzle_id
WHERE s.day = @day;

-- name: CountArchive :one
-- Puzzles up to today, for paging.
SELECT count(*)::int AS total FROM daily_schedule WHERE day <= @today;

-- name: ListArchive :many
-- Newest first, with the caller's own result if they have one (@player_id 0 = nobody).
SELECT s.number, s.day, p.difficulty, p.plies,
       a.status AS result_status,
       a.hints_used AS result_hints,
       (SELECT count(*)::int FROM guesses g WHERE g.attempt_id = a.id) AS result_guesses
FROM daily_schedule s
JOIN puzzles p ON p.id = s.puzzle_id
LEFT JOIN attempts a ON a.puzzle_id = p.id AND a.player_id = @player_id
WHERE s.day <= @today
ORDER BY s.day DESC
LIMIT @page_size OFFSET @page_offset;
