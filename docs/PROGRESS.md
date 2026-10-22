# Progress

Claude Code updates this file at the end of every phase. Newest phase at the top.

## Status

| Phase | Name | Status | Tag |
|---|---|---|---|
| 0 | Foundations | done (2026-10-22) | `phase-0` |
| 1 | Engine core | done (2026-10-22) | `phase-1` |
| 2 | Retro analysis | not started | |
| 3 | Proof-game solver | not started | |
| 4 | Puzzle generator | not started | |
| 5 | Web shell and Lab | not started | |
| 6 | API core | not started | |
| 7 | Daily UI, leaderboards, profiles, archive | not started | |
| 8 | Sign in with Lichess | not started | |
| 9 | Polish and ship | not started | |

## Measurements

| Metric | Value | Date |
|---|---|---|
| Perft nodes/second (Node, start position depth 5) | ≈4.0M nodes/s (median of 3 runs: 3.4M, 4.0M, 4.2M); Kiwipete depth 4: 5.4M. Node 24.13, owner's Windows 10 machine, `pnpm --filter @retrograde/engine perft 5` | 2026-10-22 |
| Solver median / p95 at N = 6, 8, 10 | | |
| Generator acceptance rate and time per puzzle by N | | |
| Main-thread JS bundle (gzipped) | | |
| Lighthouse accessibility, /daily and /lab | | |

## Phase log

### Phase 1: Engine core (2026-10-22)

**Done, by acceptance criterion**
- **Perft at fast depths, slow suite at depth 5 plus start depth 6.** Six reference positions: the five from SPEC §4.7 plus chessprogramming.org's Position 6 (owner's request), all numbers checked against the Perft Results page. Fast suite: start d4, Kiwipete d3, Pos 3 d4, Pos 4 d4, Pos 5 d3, Pos 6 d3. Slow suite: d5 for all six, and the start position at d6.
- **Property tests:** FEN round-trip; make+unmake restores every field; incremental Zobrist hash = recomputed hash; SAN and UCI round-trip for every legal move. These run on seeded random games that favour castling, en passant and promotion (the test asserts each actually occurs): 20 games in the fast suite, 400 longer ones in the slow suite. The same invariants are also checked in random play from nine illegal-but-parseable positions (king capture, two kings, back-rank pawns, no kings, many queens).
- **`replay` handles every special move:** seven reference games built and cross-checked with python-chess (used only as a local tool, not a dependency). Between them they cover both castles for both sides, en passant for both sides, promotions to all four pieces (with and without capture, both colours), checkmate as the last move, a discovered double check, and `illegalAt`/reason reporting.
- **Perft speed recorded:** ≈4.0M nodes/s (see Measurements).
- Also: §11.2's 90% engine statement coverage is enforced in the engine's `test` script (currently 96.25%). The owner's en passant decisions (FEN `-` means "not stated" for retro analysis; ep file hashed only when capturable) are in SPEC §4.5, §5.3, §5.5 and DECISIONS.md. Engine version bumped to 0.1.0.

**Evidence**
- `pnpm check`: all green. Engine: 9 test files, 146 tests passed, statements 96.25% (720/748). Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `pnpm --filter @retrograde/engine test:slow` (494 s): start d5 = 4,865,609 ✓; Kiwipete d5 = 193,690,690 ✓; Pos 3 d5 = 674,624 ✓; Pos 4 d5 = 15,833,292 ✓; Pos 5 d5 = 89,941,194 ✓; Pos 6 d5 = 164,075,551 ✓; start d6 = 119,060,324 ✓; 400 random games ✓.
- Move-generation, notation and replay expectations were cross-checked against python-chess 1.11.2; the RNG's reference values against an independent Python implementation of splitmix32.
- **Self-review** (separate review agent): no blockers. Fixed:
  - added a game with queen and bishop promotions, including a quiet one;
  - run the full invariants from illegal positions, not just "doesn't throw";
  - made the from-scratch hash test meaningful by playing castling, en passant and a promotion first, and isolated placement in another hash test;
  - stopped `parseFen` accepting the Kelvin sign (K) as a king;
  - made `isSquareAttacked(-1)` return false instead of true;
  - stopped castling onto an attacked square in two-king positions;
  - removed a tuple allocation on castling make/unmake;
  - reject `x` on quiet SAN moves;
  - made fast-check report a failing seed at once (`endOnFailure`);
  - added a test that pins down parsing of an en passant square on the wrong rank.

**Known issues / follow-ups**
- The slow suite takes about 8 minutes, so it runs nightly in CI, not on every push.
- In positions with several kings of one colour, legality is judged against one tracked king (DECISIONS.md). This only affects illegal positions.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests with coverage:
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Test Files  9 passed`, `Tests  146 passed` and a coverage summary with `Statements : 96.25%`.
2. Measure move-generation speed (counts every position 5 moves deep from the start):
   ```powershell
   pnpm --filter @retrograde/engine perft 5
   ```
   You should see `nodes    4,865,609` and a speed of a few million nodes/s. Try a harder position, for example `pnpm --filter @retrograde/engine perft 4 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"`, which should report `nodes    4,085,603`.
3. Optional, takes about 8 minutes: the slow suite.
   ```powershell
   pnpm --filter @retrograde/engine test:slow
   ```
   Expect `Tests  8 passed`, including `start depth 6 = 119060324`.
4. Everything still passes together:
   ```powershell
   pnpm check
   ```

### Phase 0: Foundations (2026-10-22)

**Done, by acceptance criterion**
- **Clean clone works (Windows and Ubuntu).** pnpm workspace with `@retrograde/engine` (empty library, one test), `@retrograde/generator` (placeholder CLI) and `@retrograde/web`; Go module `services/api` with `serve` and `migrate`; goose with an empty initial migration embedded in the binary; root scripts `dev`, `check`, `test:api`, `gen`, `db:migrate`, `db:up`/`db:down`, `build` (plus `lint`, `format`, `typecheck`, `test`, `check:go`, `test:hooks`). `seed` (Phase 6), `start` (Phase 9) and `test:e2e` (Phase 5) arrive with the phases that give them something to do.
- **`pnpm dev` shows "API: ok".** `GET /api/health` (200 `{"status":"ok","db":"ok"}`, or 503 when the database doesn't answer within 2 s), called by the placeholder page through the Vite proxy.
- **`pnpm gen` produces no diff.** One contract (`api/openapi.yaml`) → oapi-codegen strict server (Go) + openapi-typescript (TS); sqlc for SQL. Tools pinned with Go's `tool` directive in `services/api/tools/go.mod`.
- **Hook active and tested.** `prepare` sets `core.hooksPath`; `scripts/test-commit-msg-hook.mjs` proves the trailer is stripped in a throwaway temp repo.
- **CI green on Ubuntu and Windows**, with Go module/build caches keyed on both `go.sum` files and a nightly slow-test job.
- Also: ESLint (typescript-eslint strict type-checked), Prettier, golangci-lint v2 configs; `LICENSE` (GPL-3.0 text); `.env.example`; `.nvmrc`; README skeleton; optional docker-compose Postgres on port 5433. Spec gaps 9–18 settled with the owner and folded into SPEC.md (DECISIONS.md, 2026-10-22).

**Evidence**
- `pnpm check` on this machine: ESLint + Prettier clean; `tsc` clean in all three packages; Vitest engine 1/1, generator 1/1, web 3/3; `go vet` clean; golangci-lint `0 issues`; Go unit tests ok (`cmd/retrograde`, `internal/config`, `internal/httpapi`); hook test passed.
- `pnpm test:api` (integration, `retrograde_test`): ok for `cmd/retrograde`, `internal/config`, `internal/httpapi`, `internal/store` (migrate twice = idempotent, real-database health check returns 200).
- Clean clone into a temp folder whose path contains a space: `pnpm install` → exit 0, `core.hooksPath` = `.githooks`; `pnpm db:migrate` → exit 0; `pnpm check` → exit 0; `pnpm gen` → no changes.
- `pnpm dev`: `curl http://localhost:5173/api/health` → `200 {"db":"ok","status":"ok"}`; a headless browser load of `http://localhost:5173/` shows "API: ok" with 0 console errors and 0 failed requests; `POST /api/health` → `405` problem+json with `Allow: GET, HEAD`.
- GitHub Actions run 39688748846 (first push): Ubuntu ✓ (3m09s, cold cache), Windows ✓ (1m35s). The run on the final Phase 0 commit is linked from the `phase-0` tag's commit on GitHub.
- **Self-review** (a separate review agent, against the acceptance criteria and CLAUDE.md): no blockers. Fixed: wrong-method requests returned 404 instead of 405; handler log lines lacked `request_id`; CI could cancel runs on `main`; a second Ctrl+C during shutdown was swallowed; `migrate` had no connect timeout; an empty exported variable hid the `.env` value; IPv6 `HOST` produced an invalid address; `KEY="v" # comment` kept its quotes; the hook test crashed instead of explaining when `core.hooksPath` was unset; `/health` didn't declare its problem+json errors; `.vscode/` wasn't gitignored; README lacked the cmd.exe copy command. Each fix has a test where one makes sense.

**Known issues / follow-ups**
- TypeScript is pinned to 6.0.3 because typescript-eslint and openapi-typescript don't support TypeScript 7 yet (DECISIONS.md). Revisit later.
- The first `pnpm gen` / `pnpm check` on a new machine compiles the Go tools (sqlc, golangci-lint) and can take several minutes; later runs are cached.
- Windows' 260-character path limit: a clone nested very deep in folders can make pnpm fail with "The system cannot find the path specified". The project's normal location is fine. If you ever hit it, move the clone to a shorter path or enable Windows long paths.
- CLAUDE.md's generator command is fixed in Phase 4 (DECISIONS.md, 2026-10-22, item 8).

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Install and check everything:
   ```powershell
   pnpm install
   pnpm check
   ```
   You should see "All matched files use Prettier code style!", three Vitest summaries with all tests passed, `0 issues.` from golangci-lint, `ok` lines from `go test`, and "commit-msg hook test passed". The first run may spend a few minutes compiling Go tools.
2. Prepare the database (your `.env` already exists; on a fresh clone run `Copy-Item .env.example .env` first and fill in your PostgreSQL user and password):
   ```powershell
   pnpm db:migrate
   ```
   The last line should be a JSON log with `"msg":"database is up to date"` and `"version":1`.
3. Run the app:
   ```powershell
   pnpm dev
   ```
   Wait for `[api] … "msg":"listening"` and `[web] … Local: http://localhost:5173/`, then open http://localhost:5173. The page says **Retrograde** and **"API: ok"**. Each page load adds a `"msg":"request"` log line with `"status":200` and a `request_id`.
4. See the failure path: stop your PostgreSQL service (Windows **Services** app → `postgresql-x64-18` → Stop), reload the page: it says **"API: unavailable"** within about 2 seconds. Start the service again and reload: back to "API: ok". Stop `pnpm dev` with `Ctrl+C`.
5. Run the database integration tests:
   ```powershell
   pnpm test:api
   ```
   Expect `ok` for `internal/httpapi` and `internal/store`.
6. Check that codegen is in sync and commits stay yours:
   ```powershell
   pnpm gen
   git status --short
   git log -5 --format="%an <%ae> | %s"
   ```
   `git status` should show nothing new from `pnpm gen`, and every log line should show you.

<!-- Template for each phase entry:
### Phase N: Name (YYYY-MM-DD)
- Done: what was built, by acceptance criterion
- Evidence: test/check summary, self-review findings and fixes
- Known issues / follow-ups
- How to try it: exact commands for the VS Code terminal (PowerShell) and what you should see
-->
