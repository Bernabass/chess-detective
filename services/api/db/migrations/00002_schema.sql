-- +goose Up
-- The data model of SPEC §10.3, finalized in Phase 6 (DECISIONS 2026-10-23).
-- In public explicitly: integration tests migrate into their own schemas (search_path
-- "<test schema>, public"), and the extension must outlive any one of them.
CREATE EXTENSION IF NOT EXISTS citext SCHEMA public;

CREATE TABLE users (
  id               bigserial PRIMARY KEY,
  username         citext UNIQUE NOT NULL CHECK (username ~ '^[A-Za-z0-9_-]{3,20}$'),
  password_hash    text,                     -- argon2id PHC string; null for Lichess-only users
  lichess_user_id  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Every visitor who starts a puzzle is a player; guests have user_id NULL.
CREATE TABLE players (
  id          bigserial PRIMARY KEY,
  user_id     bigint UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Guest cleanup scans old guests.
CREATE INDEX players_guests_created_at ON players (created_at) WHERE user_id IS NULL;

CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,           -- sha256 of the token; the token is only in the cookie
  player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
CREATE INDEX sessions_player_id ON sessions (player_id);

CREATE TABLE puzzles (
  id              bigserial PRIMARY KEY,
  external_id     text UNIQUE NOT NULL,      -- generator id: makes import idempotent
  plies           int  NOT NULL CHECK (plies BETWEEN 1 AND 40),
  target          text NOT NULL,             -- target key
  solution        text[] NOT NULL,           -- UCI; NEVER returned before the attempt finishes
  difficulty      smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  features        text[] NOT NULL DEFAULT '{}',
  solver_nodes    bigint NOT NULL,
  engine_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(solution) = plies)
);
-- Scheduling picks the lowest unscheduled id of a difficulty.
CREATE INDEX puzzles_difficulty_id ON puzzles (difficulty, id);

CREATE TABLE daily_schedule (
  day        date PRIMARY KEY,
  number     int UNIQUE NOT NULL CHECK (number >= 1),
  puzzle_id  bigint UNIQUE NOT NULL REFERENCES puzzles(id)
);

CREATE TYPE attempt_status AS ENUM ('in_progress', 'solved', 'failed');

CREATE TABLE attempts (
  id           bigserial PRIMARY KEY,
  player_id    bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  puzzle_id    bigint NOT NULL REFERENCES puzzles(id),
  is_archive   boolean NOT NULL,
  status       attempt_status NOT NULL DEFAULT 'in_progress',
  hints_used   smallint NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3),
  -- Hint 3 reveals the solution move at the first non-green ply of the latest guess when it was
  -- taken; stored so it doesn't change with later guesses (1-based ply).
  hint_move_ply smallint CHECK (hint_move_ply BETWEEN 1 AND 40),
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  UNIQUE (player_id, puzzle_id)
);
-- The daily leaderboard: solved, non-archive attempts of one puzzle.
CREATE INDEX attempts_leaderboard ON attempts (puzzle_id, finished_at)
  WHERE status = 'solved' AND NOT is_archive;

CREATE TABLE guesses (
  attempt_id  bigint NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  idx         smallint NOT NULL CHECK (idx BETWEEN 0 AND 5),
  moves       text[] NOT NULL,
  feedback    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, idx)
);

CREATE TABLE player_stats (
  player_id       bigint PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  played          int NOT NULL DEFAULT 0,
  solved          int NOT NULL DEFAULT 0,
  current_streak  int NOT NULL DEFAULT 0,
  max_streak      int NOT NULL DEFAULT 0,
  last_solved_day date,
  guess_dist      int[] NOT NULL DEFAULT '{0,0,0,0,0,0,0}',  -- 1..6 guesses, index 7 = failed
  hints_total     int NOT NULL DEFAULT 0                       -- for the profile's average hints
);

CREATE TABLE oauth_states (
  state_hash     bytea PRIMARY KEY,
  code_verifier  text NOT NULL,
  player_id      bigint REFERENCES players(id) ON DELETE CASCADE,  -- guest to merge
  return_to      text NOT NULL,
  expires_at     timestamptz NOT NULL
);
CREATE INDEX oauth_states_expires_at ON oauth_states (expires_at);

-- +goose Down
DROP TABLE oauth_states;
DROP TABLE player_stats;
DROP TABLE guesses;
DROP TABLE attempts;
DROP TYPE attempt_status;
DROP TABLE daily_schedule;
DROP TABLE puzzles;
DROP TABLE sessions;
DROP TABLE players;
DROP TABLE users;
