-- Players, users and sessions (SPEC §10.6).

-- name: CreatePlayer :one
INSERT INTO players (user_id, created_at) VALUES (sqlc.narg('user_id'), @created_at)
RETURNING id;

-- name: GetPlayer :one
-- A player with its user, if any.
SELECT p.id, p.user_id, p.created_at, u.username
FROM players p
LEFT JOIN users u ON u.id = p.user_id
WHERE p.id = @id;

-- name: DeletePlayer :exec
DELETE FROM players WHERE id = @id;

-- name: CreateUser :one
INSERT INTO users (username, password_hash, created_at) VALUES (@username, @password_hash, @created_at)
RETURNING id, username, created_at;

-- name: GetUserByUsername :one
SELECT u.id, u.username, u.password_hash, u.created_at, p.id AS player_id
FROM users u
JOIN players p ON p.user_id = u.id
WHERE u.username = @username;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, player_id, created_at, last_seen_at, expires_at)
VALUES (@token_hash, @player_id, @now, @now, @expires_at);

-- name: GetSession :one
-- A session that hasn't expired at @now.
SELECT player_id, last_seen_at, expires_at
FROM sessions
WHERE token_hash = @token_hash AND expires_at > @now;

-- name: TouchSession :exec
-- The sliding expiry (written at most once an hour per session; DECISIONS 2026-10-23).
UPDATE sessions SET last_seen_at = @now, expires_at = @expires_at WHERE token_hash = @token_hash;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = @token_hash;

-- name: MoveGuestAttempts :execrows
-- Guest merge: the guest's attempts at puzzles the account hasn't played move to the account.
UPDATE attempts SET player_id = @user_player_id
WHERE attempts.player_id = @guest_player_id
  AND attempts.puzzle_id NOT IN (SELECT a.puzzle_id FROM attempts a WHERE a.player_id = @user_player_id);

-- name: GetUserByLichessID :one
-- The only way a Lichess sign-in finds an existing account: never by username.
SELECT u.id, u.username::text AS username, p.id AS player_id
FROM users u
JOIN players p ON p.user_id = u.id
WHERE u.lichess_user_id = @lichess_user_id;

-- name: CreateLichessUser :one
-- No row if the username or the Lichess id is already taken (the caller tries the next name,
-- or finds the account another request just created).
INSERT INTO users (username, lichess_user_id, lichess_username, created_at)
VALUES (@username, @lichess_user_id, @lichess_username, @created_at)
ON CONFLICT DO NOTHING
RETURNING id, username::text AS username;

-- name: SetLichessUsername :exec
UPDATE users SET lichess_username = @lichess_username WHERE id = @id;
