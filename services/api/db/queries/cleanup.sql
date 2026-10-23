-- The cleanup job (DECISIONS 2026-10-23).

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= @now;

-- name: DeleteIdleGuests :execrows
-- Guest players older than @cutoff that never made a guess. Their attempts, sessions and stats
-- go with them (ON DELETE CASCADE).
DELETE FROM players p
WHERE p.user_id IS NULL
  AND p.created_at < @cutoff
  AND NOT EXISTS (
    SELECT 1 FROM attempts a JOIN guesses g ON g.attempt_id = a.id WHERE a.player_id = p.id
  );

-- name: DeleteExpiredOAuthStates :execrows
DELETE FROM oauth_states WHERE expires_at <= @now;
