-- Sign in with Lichess (SPEC §10.6). The state's hash is the key; the raw state lives only in
-- the browser (the rg_oauth cookie and the authorize URL).

-- name: InsertOAuthState :exec
INSERT INTO oauth_states (state_hash, code_verifier, player_id, return_to, expires_at)
VALUES (@state_hash, @code_verifier, sqlc.narg('player_id'), @return_to, @expires_at);

-- name: TakeOAuthState :one
-- Single use: the row is deleted as it's read.
DELETE FROM oauth_states WHERE state_hash = @state_hash
RETURNING code_verifier, player_id, return_to, expires_at;
