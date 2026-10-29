-- Leaderboards and profiles (SPEC §8.5, §10.7). Guests never appear.

-- name: DailyLeaderboard :many
-- Solved, non-archive attempts of registered players: fewer guesses, then fewer hints, then a
-- shorter time; ties share a rank and are listed by username.
WITH ranked AS (
  SELECT u.username::text AS username, a.player_id,
         (SELECT count(*)::int FROM guesses g WHERE g.attempt_id = a.id) AS guesses,
         a.hints_used::int AS hints,
         extract(epoch FROM a.finished_at - a.started_at)::bigint AS seconds
  FROM attempts a
  JOIN players p ON p.id = a.player_id
  JOIN users u ON u.id = p.user_id
  WHERE a.puzzle_id = @puzzle_id AND a.status = 'solved' AND NOT a.is_archive
)
SELECT username, player_id, guesses, hints, seconds,
       rank() OVER (ORDER BY guesses, hints, seconds)::int AS rank
FROM ranked
ORDER BY rank, username
LIMIT @row_limit;

-- name: DailyLeaderboardEntry :one
-- One player's entry, ranked among everyone (same ordering as DailyLeaderboard).
WITH ranked AS (
  SELECT u.username::text AS username, a.player_id,
         (SELECT count(*)::int FROM guesses g WHERE g.attempt_id = a.id) AS guesses,
         a.hints_used::int AS hints,
         extract(epoch FROM a.finished_at - a.started_at)::bigint AS seconds
  FROM attempts a
  JOIN players p ON p.id = a.player_id
  JOIN users u ON u.id = p.user_id
  WHERE a.puzzle_id = @puzzle_id AND a.status = 'solved' AND NOT a.is_archive
), with_rank AS (
  SELECT username, player_id, guesses, hints, seconds,
         rank() OVER (ORDER BY guesses, hints, seconds)::int AS rank
  FROM ranked
)
SELECT username, player_id, guesses, hints, seconds, rank FROM with_rank WHERE player_id = @player_id;

-- name: AllTimeLeaderboard :many
-- Top 100 by one metric. A current streak only counts while the last solve was today or
-- yesterday (@yesterday), so a player who stopped doesn't keep a stale streak.
WITH vals AS (
  SELECT u.username::text AS username,
         CASE @metric::text
           WHEN 'current_streak' THEN
             CASE WHEN st.last_solved_day >= @yesterday::date THEN st.current_streak ELSE 0 END
           WHEN 'max_streak' THEN st.max_streak
           ELSE st.solved
         END AS value
  FROM player_stats st
  JOIN players p ON p.id = st.player_id
  JOIN users u ON u.id = p.user_id
)
SELECT username, value::int AS value, rank() OVER (ORDER BY value DESC)::int AS rank
FROM vals
WHERE value > 0
ORDER BY rank, username
LIMIT 100;

-- name: GetProfile :one
SELECT u.username::text AS username, u.created_at, p.id AS player_id,
       u.lichess_user_id, u.lichess_username
FROM users u
JOIN players p ON p.user_id = u.id
WHERE u.username = @username;
