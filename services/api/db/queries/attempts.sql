-- Attempts, guesses and stats (SPEC §10.5).

-- name: CreateAttempt :exec
-- Idempotent: a second start keeps the first attempt and its started_at.
INSERT INTO attempts (player_id, puzzle_id, is_archive, started_at)
VALUES (@player_id, @puzzle_id, @is_archive, @started_at)
ON CONFLICT (player_id, puzzle_id) DO NOTHING;

-- name: GetAttempt :one
SELECT id, player_id, puzzle_id, is_archive, status, hints_used, hint_move_ply, started_at, finished_at
FROM attempts
WHERE player_id = @player_id AND puzzle_id = @puzzle_id;

-- name: LockAttempt :one
-- Serializes guesses and hints on one attempt (SPEC §10.5).
SELECT id, player_id, puzzle_id, is_archive, status, hints_used, hint_move_ply, started_at, finished_at
FROM attempts
WHERE player_id = @player_id AND puzzle_id = @puzzle_id
FOR UPDATE;

-- name: FinishAttempt :exec
UPDATE attempts SET status = @status, finished_at = @finished_at WHERE id = @id;

-- name: SetHintsUsed :exec
UPDATE attempts SET hints_used = @hints_used, hint_move_ply = sqlc.narg('hint_move_ply') WHERE id = @id;

-- name: ListGuesses :many
SELECT idx, moves, feedback FROM guesses WHERE attempt_id = @attempt_id ORDER BY idx;

-- name: InsertGuess :exec
INSERT INTO guesses (attempt_id, idx, moves, feedback, created_at)
VALUES (@attempt_id, @idx, @moves, @feedback, @created_at);

-- name: ListFinishedDailyAttempts :many
-- Everything a player's stats are computed from: finished, non-archive attempts with their
-- puzzle's day and number of guesses.
SELECT a.status, a.hints_used, s.day,
       (SELECT count(*)::int FROM guesses g WHERE g.attempt_id = a.id) AS guesses
FROM attempts a
JOIN daily_schedule s ON s.puzzle_id = a.puzzle_id
WHERE a.player_id = @player_id AND NOT a.is_archive AND a.status <> 'in_progress'
ORDER BY s.day;

-- name: UpsertStats :exec
INSERT INTO player_stats (player_id, played, solved, current_streak, max_streak, last_solved_day, guess_dist, hints_total)
VALUES (@player_id, @played, @solved, @current_streak, @max_streak, @last_solved_day, @guess_dist, @hints_total)
ON CONFLICT (player_id) DO UPDATE SET
  played = EXCLUDED.played,
  solved = EXCLUDED.solved,
  current_streak = EXCLUDED.current_streak,
  max_streak = EXCLUDED.max_streak,
  last_solved_day = EXCLUDED.last_solved_day,
  guess_dist = EXCLUDED.guess_dist,
  hints_total = EXCLUDED.hints_total;

-- name: GetStats :one
SELECT played, solved, current_streak, max_streak, last_solved_day, guess_dist, hints_total
FROM player_stats
WHERE player_id = @player_id;
