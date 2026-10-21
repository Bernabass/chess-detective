# Decisions

Append-only. Each entry: date, context, decision, consequences. Newest at the bottom.

## 2026-10-21: Stack
- Context: The engine must run in the browser and in Node; the product needs accounts, leaderboards and a server-side secret (the daily solution). The author knows TypeScript, Go, Python, C#, React and Postgres and wants a strong portfolio project.
- Decision: TypeScript for the engine, generator and web app; Go + PostgreSQL for the API.
- Consequences: Chess rules exist in two languages (TS engine, Go library on the server). Cross-language fixture tests are mandatory (SPEC §11.2).

## 2026-10-21: License
- Context: chessground is GPL-3.0.
- Decision: The whole repository is GPL-3.0-or-later.
- Consequences: Every dependency must be GPL-compatible. The source must stay public.

## 2026-10-21: Plies and target comparison
- Decision: All internal lengths are plies. Daily targets compare piece placement + side to move only.
- Consequences: Castling rights, en passant and clocks in a target are ignored, which matches proof-game problem conventions.

## 2026-10-21: Day boundary
- Decision: A puzzle day is a UTC calendar day; puzzle #1 is `LAUNCH_DATE`.
- Consequences: Players far from UTC see the new puzzle at a fixed local time, not midnight.

## 2026-10-21: Windows-first tooling
- Context: The owner develops on Windows 10 in VS Code with the Claude Code extension. `make` isn't available there by default.
- Decision: No Makefile. All tasks are cross-platform root `package.json` scripts backed by Node helpers; LF line endings via `.gitattributes`; CI also runs on `windows-latest`.
- Consequences: Scripts avoid shell-specific syntax. Tools that can't run natively on Windows run through Docker.

## 2026-10-21: Commit authorship
- Context: The repository is the owner's portfolio. Every commit must show only the owner's GitHub account.
- Decision: Commits use the repo's git identity only: the owner's GitHub username and the email on their GitHub account, like any normal developer. AI attribution is disabled in `.claude/settings.json` (`attribution.commit`/`pr` empty, `sessionUrl` false) and stripped by `.githooks/commit-msg` as a backstop. No GitHub app or bot account is used.
- Consequences: The hook must stay enabled (`core.hooksPath .githooks`, set by `pnpm install`).

## 2026-10-21: Retraction castling rights
- Decision: Normal retractions copy the current castling rights to the prior position; only un-castling adds a right (SPEC §5.3).
- Consequences: Analysis stays sound. Some prior positions may have had more rights than shown, which doesn't affect any verdict.

## 2026-10-22: Phase 0 spec adjustments
- Context: Writing the Phase 0 plan turned up gaps between the spec, the tools and the local setup.
- Decision:
  1. CI builds the Docker image only from Phase 9, when the `Dockerfile` exists (§11.3).
  2. sqlc refuses to run with no queries, so Phase 0 adds one `Ping` query (`SELECT 1`), which `/api/health` uses for its database check.
  3. `GET /api/health` returns 200 `{"status":"ok","db":"ok"}`, or 503 `{"status":"unavailable","db":"error"}` when the database doesn't answer within 2 seconds (§10.4).
  4. `docker-compose.yml` publishes Postgres on host port **5433**, so it can run next to the owner's local PostgreSQL service on 5432. `.env.example` shows both URLs.
  5. The commit-msg hook acceptance test runs in a throwaway repository in the OS temp folder (`scripts/test-commit-msg-hook.mjs`), so this repository's history never contains a commit with an AI trailer, as `CLAUDE.md` requires.
  6. A clean clone has no `.env`. "How to try it" includes copying `.env.example` to `.env`, and every command that needs `DATABASE_URL` stops with a clear message when it's missing.
  7. §3.4's "pin each tool in Phase 0" is read as: pin everything Phase 0 installs; each later phase pins and records the dependencies it adds.
  8. `CLAUDE.md`'s generator command omits the `generate` subcommand from §7.1. It gets fixed in Phase 4, when the CLI exists.
- Consequences: SPEC §3.3, §10.4 and §11.3 were updated to match.

## 2026-10-22: Go tools pinned with the `tool` directive
- Context: oapi-codegen, sqlc, goose and golangci-lint must run identically on Windows and in CI, without global installs. sqlc v1.31.1 builds natively on Windows without a C compiler (checked during setup; the first compile takes about 15 minutes, later runs are cached).
- Decision: The tools are declared with Go's `tool` directive in a separate module, `services/api/tools/go.mod`, and run with `go tool -modfile=tools/go.mod <tool>`. No Docker fallback is needed. CI caches Go's module and build caches (`actions/setup-go` keyed on both `go.sum` files) so sqlc isn't rebuilt on every run.
- Consequences: The tools' dependencies don't leak into the API module's `go.mod`. A first `pnpm gen` or `pnpm check` on a new machine is slow while the tools compile.

## 2026-10-22: Settled spec gaps for later phases
- Context: Reviewing the spec before Phase 0 found ten gaps in later phases. The owner decided each one; SPEC.md now holds the settled versions.
- Decision:
  9. **Viability (§5.4).** A retraction to P′ is viable at depth k if P′ passes every static rule except `NO_POSSIBLE_LAST_MOVE` (which is defined by viability), and k = 1, or P′ is the initial position, or P′ has a retraction viable at depth k−1.
  10. **Impossible pawn structures (§5.2, §5.2.1).** When a side's pawns can't be assigned to distinct starting files at all (e.g. white pawns a2, b2, a3, b3), the position is illegal under a new rule, `PAWN_STRUCTURE_IMPOSSIBLE`. Its message names a pawn that has no possible starting file.
  11. **`LAST_MOVE_FORCED` (§5.2, §5.4)** counts distinct moves, not retractions. If one move could have captured different pieces, the message says so ("…capturing a knight or a bishop").
  12. **Difficulty cut points (§7.3, §8.7, Phase 4).** Stars use weekly-ramp quantile cut points (1/7, 3/7, 5/7, 6/7) and the pool has at least 500 puzzles. `schedule` prints how many unscheduled puzzles of each level remain.
  13. **Hint 3 (§8.4)** reveals the solution move at the first non-green ply of the player's most recent guess, or ply 1 if they haven't guessed yet.
  14. **Guest sessions (§10.4).** Both `GET /daily` and `GET /daily/{number}` create a guest session when there isn't one, so archive links work for new visitors.
  15. **Midnight crossing (§8.5, §10.5).** `is_archive` is fixed when the attempt is created; a solve counts for the puzzle's own day.
  16. **Move limit (§10.5).** A request body with more than 40 moves is rejected (400) before any database work; otherwise a guess must have exactly the puzzle's ply count (422).
  17. **Embedding the web build (§10.1, §11.5).** The build copies `apps/web/dist` into `services/api/internal/webui/dist` (gitignored), because `go:embed` can't read outside the Go module.
  18. **Client IP behind proxies (§10.2, §10.6).** New setting `TRUSTED_PROXIES` (comma-separated IPs/CIDRs, empty by default). `X-Forwarded-For` is trusted only when the direct peer is in that list.
- Consequences: Phases 2, 4, 6, 7 and 9 implement the settled versions. The Phase 4 pool target rises from 400 to 500 puzzles.

## 2026-10-22: Phase 0 versions
- Context: SPEC §3.4 asks for each tool pinned to its latest stable version.
- Decision: Exact versions, no ranges:
  - Runtime and package manager: Node 24 LTS (`.nvmrc`, `engines`), pnpm 12.14.0 (`packageManager`), Go 1.27 (`go.mod`).
  - TypeScript tooling: TypeScript **6.0.3**, ESLint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.72.0, eslint-config-prettier 10.1.8, eslint-plugin-react-hooks 7.1.1, eslint-plugin-react-refresh 0.5.7, globals 17.13.0, Prettier 3.9.10, Vitest 5.0.5, tsx 4.23.15, concurrently 10.0.6, @types/node 26.6.5.
  - Web: React 19.3.1, react-dom 19.3.1, @tanstack/react-query 5.104.5, openapi-fetch 0.17.0, openapi-typescript 7.13.0, Vite **8.3.4**, @vitejs/plugin-react 6.1.2, jsdom 30.1.3, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/jest-dom 7.0.1, @types/react 19.3.0, @types/react-dom 19.3.0.
  - Go libraries: pgx v5.11.0, goose v3.29.0. Go tools: oapi-codegen v2.8.0, sqlc v1.31.1, goose v3.29.0, golangci-lint v2.15.0.
  - Docker and CI: postgres:18.4 (same major as the owner's local server); actions/checkout v7, actions/setup-node v7, actions/setup-go v7, pnpm/action-setup v6.
- Exceptions to "latest":
  - **TypeScript 6.0.3, not 7.0.2.** TypeScript 7 is the native (Go) compiler and has no stable JavaScript API yet. typescript-eslint 8.72 requires `<6.1.0`, and openapi-typescript uses the TS API. 6.0 is the newest line every tool supports. openapi-typescript's peer range still says `^5`; `pnpm-workspace.yaml` allows 6, and `pnpm gen` is verified to work with it. Revisit when typescript-eslint supports 7.
  - **Vite 8.3.4, not 8.3.5.** 8.3.5 was published on 2026-10-21, inside pnpm's minimum-release-age window (a supply-chain guard against freshly published compromised versions). We pin the previous release rather than bypass the guard.
- Consequences: Upgrades are deliberate commits with their own DECISIONS entry.

## 2026-10-22: Dependency install scripts
- Context: pnpm 12 blocks dependency install scripts unless they're allowed, and fails the install on blocked ones.
- Decision: Only `esbuild` is allowed (`allowBuilds` in `pnpm-workspace.yaml`). Its postinstall only verifies its platform-specific binary.
- Consequences: Any new dependency with an install script needs a conscious allow-list entry.

## 2026-10-22: `HOST` setting
- Context: SPEC §10.2 has only `PORT`. Listening on all interfaces makes Windows show a firewall prompt, and `go run` builds a new executable each time, so the prompt would come back on every `pnpm dev`. It would also expose the dev API to the local network.
- Decision: New optional setting `HOST`, default `127.0.0.1`. The production container sets `HOST=0.0.0.0` (Phase 9). The Vite proxy targets the same host and port.
- Consequences: SPEC §10.2 and `.env.example` list `HOST`.

## 2026-10-22: `.env` loading in Go
- Context: CLAUDE.md requires Go programs to load `.env` themselves, with no exported variables needed.
- Decision: A small standard-library parser in `internal/config` (no dotenv dependency). It finds the nearest `.env` above the working directory, stopping at the repository root (the folder with `.git`). Real environment variables take priority, and the process environment is never modified: config reads through a lookup function, so there's no global mutable state.
- Consequences: Supports `KEY=VALUE`, comments, `export`, quotes and a leading BOM (Notepad). It doesn't support multi-line values or variable expansion.
