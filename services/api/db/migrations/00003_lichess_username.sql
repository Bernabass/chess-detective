-- +goose Up
-- How the user writes their Lichess name, for the profile link (refreshed at each sign-in;
-- Lichess only allows case changes). Linking is by lichess_user_id alone (DECISIONS 2026-10-29).
ALTER TABLE users ADD COLUMN lichess_username text;

-- +goose Down
ALTER TABLE users DROP COLUMN lichess_username;
