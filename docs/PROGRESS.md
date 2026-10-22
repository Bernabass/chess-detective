# Progress

Claude Code updates this file at the end of every phase. Newest phase at the top.

## Status

| Phase | Name | Status | Tag |
|---|---|---|---|
| 0 | Foundations | done (2026-10-22) | `phase-0` |
| 1 | Engine core | done (2026-10-22) | `phase-1` |
| 2 | Retro analysis | done (2026-10-22) | `phase-2` |
| 3 | Proof-game solver | done (2026-10-22) | `phase-3` |
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
| Solver median / p95 at N = 6, 8, 10 | find-one: 2 / 6 ms, 2 / 11 ms, 4 / 191 ms. count (cap 2): 2 / 5 ms, 2 / 33 ms, 2 / 167 ms (worst 436 ms). Median nodes 7–14. 50 targets of uniformly random games per N, `pnpm --filter @retrograde/engine bench` | 2026-10-22 |
| Generator acceptance rate and time per puzzle by N | | |
| Main-thread JS bundle (gzipped) | | |
| Lighthouse accessibility, /daily and /lab | | |

## Phase log

### Phase 3: Proof-game solver (2026-10-22)

**Done, by acceptance criterion**
- **Admissibility over ≥ 5,000 games fast / 100,000 slow, with castling, promotion and en passant.**
  - The lower bound (`packages/engine/src/solver/bound.ts`) implements §6.3 with the owner-approved correction: a non-pawn target piece may be a promoted pawn at cost 0, at most E times per kind.
  - It also has the castling trap, light/dark bishops as separate kinds, and the feasibility rules.
  - The property test (`test/solver/bound-properties.test.ts`, slow: 4 × 25,000) checks every position of every game. It asserts that castling, en passant and promotion games occur, and so does the pattern that breaks a forced matching: a promotion to a kind the side already has, with the original captured later (116 such games per 1,000).
  - The dedicated counterexample test (1.g8=N Rxa1) is in `bound.test.ts`.
- **Brute-force cross-check N ≤ 4 fast, N = 5 slow.**
  - Every target at N = 1–3 and 500 sampled at N = 4 (197,281 games) match the solver's counts exactly; so do 500 sampled at N = 5 (4,865,609 games).
  - Since the self-review, the fast suite also checks targets with zero 4-ply games and checks that find-all collects exactly the brute-force number of distinct games.
- **Every random-game target up to N = 10 solved `complete`.** 2 per N in the fast suite, 20 per N in the slow suite. Each proof replays to the target.
- **Bench recorded; median at N = 8 within target.** The median at N = 8 is 2 ms against the ~5 s target (see Measurements). The solver: depth-first search with exact remaining plies, per-side budgets, ordering by bound in find modes, and a fixed-size transposition table for memoized counting.
- **`analyzePosition` returns `legal` with a proof for the §5.5 fixture.**
  - Every "legal" fixture now gets verdict `legal` with a shortest proof that replays and keeps the stated castling rights and en passant square. That includes 1.e4 e5 written with `-`, 1.e4 with e3 stated, 1.e4 d5 2.exd5, and the castled position (7 plies).
  - Quick proof attempt: 10 plies / 750 ms / 1,000,000 nodes by default; otherwise `undecided` with a reason (SPEC §5.1).
- Also: `solveProofGame` and `shortestProofGame` are public, with `castling`/`enPassant` claim options and `ttBits`; `pnpm --filter @retrograde/engine bench`; engine version 0.3.0. The replay vectors were regenerated, and only their `engineVersion` changed.

**Evidence**
- `pnpm check`: all green, about 102 s with warm caches (138 s on a cold first run after a restart). Engine unit tests: 16 files, 261 tests, statements 93.91%. Engine property tests: 9 files, 35 tests (about 59 s). Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `test:slow` (1,649 s): 29/29 passed. That covers all perft rows (including start d6 = 119,060,324), 100,000-game admissibility, N = 5 brute force, 20 random targets per N up to 10, the 50,000-node progress callback, 50,000-position retraction completeness/soundness, and analyzer claims on 3,000+ positions (now including proof attempts, about 26 min).
- **Self-review** (separate review agent): no admissibility or count bugs. It independently verified:
  - pawn distances against BFS;
  - 200,000 random pawn sets against a brute-force matching;
  - 30,000 extra stress games;
  - 1,805 search-versus-brute-force checks (en passant and castling requirements, find-all, zero targets, shared table);
  - that the admissibility test fails on 27 games when the bound is deliberately broken back to a forced matching.

  Fixed:
  - Limits were first checked at node 4,096, so a 750 ms budget measured 813 ms. Now they're checked on the first node and every 256 nodes, `shortestProofGame` stops before another length once its budget is spent, and a test holds a 100 ms budget to under 400 ms.
  - A 13 MB table was allocated on every Lab analysis; it's now lazy.
  - Table counts could wrap negative; they now saturate.
  - Comments and DECISIONS wording; SPEC now says `shortestProofGame` takes no `cap`.

**Known issues / follow-ups**
- On searches that prune poorly (12 plies back to the start position), count mode runs at only about 6,000 nodes/s, because it evaluates the bound for every child. Real puzzle targets prune so hard that this doesn't matter (median 9–14 nodes). If the Phase 4 generator's "shortest" checks at N − 2, N − 4, … turn out slow, an incremental bound is the first optimization to try.
- The promotion allowance (cost 0, E per kind) is deliberately loose. It's admissible, but a tighter promotion cost (the pawn's distance to the last rank) could speed up targets with promotions.
- The nightly slow suite now takes about 27 minutes, dominated by the analyzer-claims property.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests:
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Tests  261 passed` with `Statements : 93.91%`, then `Tests  35 passed`.
2. Benchmark the solver:
   ```powershell
   pnpm --filter @retrograde/engine bench
   ```
   You should see six lines (N = 6, 8, 10 × find-one / count). Medians are a few milliseconds and the median node counts are in the teens.
3. Find a shortest proof game and analyze a legal position:
   ```powershell
   cd packages/engine
   npx tsx -e "import { shortestProofGame, analyzePosition, parseFen } from './src/index'; console.log(shortestProofGame('r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b', 12, { castling: 'kq' })); const p = parseFen('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'); if (p.ok) console.log(analyzePosition(p.value).verdict);"
   cd ../..
   ```
   The first result has `plies: 7` and the proof `g1f3 b8c6 g2g3 c6b8 f1g2 b8c6 e1g1`. The second has `kind: 'legal'` with the proof `e2e4 d7d5 e4d5`.
4. Optional, about 27 minutes: `pnpm --filter @retrograde/engine test:slow` should end with `Tests  29 passed`.
5. `pnpm check` should pass.

### Phase 2: Retro analysis (2026-10-22)

**Done, by acceptance criterion**
- **Every §5.2 rule, with trigger and non-trigger tests.**
  - All 16 rules from SPEC §5.2 plus the owner-approved `NO_POSSIBLE_HISTORY`, each with plain-English messages and highlight squares (plus arrows for forced moves). Code: `packages/engine/src/retro/rules.ts`, `pawns.ts`, `analyze.ts`.
  - Pawn accounting uses an exact bitmask dynamic program, and a maximum matching whose Hall-violating group is named in `PAWN_STRUCTURE_IMPOSSIBLE` messages.
  - Tests: `test/retro/rules.test.ts` (trigger and silent cases per rule, silence on 8 real-game positions), `pawns.test.ts`, `lastmoves.test.ts`.
- **Completeness and soundness, 2,000 fast / 50,000 slow.**
  - Completeness: for every legal move from each random position P (giving Q), `retractions(Q)` must contain P with only the unknowable fields left out. Checked for Q as played, Q with `-` for en passant, and Q with `-` for castling.
  - Soundness: every retraction of every visited position is confirmed independently with the full move generator.
  - Split into 4 files each (fast 4 × 500, slow 4 × 12,500) so they run in parallel.
- **At least 30 curated fixtures, including the §5.5 table.** `test/fixtures/positions.json` has 37 positions, each with a reasoning comment: all 10 from §5.5, every illegal rule, deductions, a forced last move, a missing last move, a depth-2 dead end, castling claims, un-castling, unpromotion and un-en-passant. Every fixture's proof game was replayed by both the engine and python-chess.
- **`lastMoves` with depth and limits; `LAST_MOVE_FORCED` and `NO_POSSIBLE_LAST_MOVE` tested.** Viability is three-state (viable / not viable / unknown), with node, time and stop limits, and claims are made only from definite results. Tests cover depth changing the verdict, limits producing `unknown` without claims, forced moves (including the "possibly en passant" wording), and the silent cases.
- **`pnpm --filter @retrograde/engine fixtures` writes `fixtures/replay-vectors.json`.**
  - 520 legal games (251 castles, 73 en passant captures, 317 promotions of which 248 underpromotions) and 132 illegal ones covering 6 kinds.
  - Generation is deterministic (a regenerated file is byte-identical), and python-chess agrees on all 652 games.
  - An engine test fails if the file goes stale.
- Also:
  - Owner decisions folded into SPEC §5 and DECISIONS.md: stated castling rights constrain the last move, `NO_POSSIBLE_HISTORY`, three-state viability, bitmask DP plus Hall group.
  - A new property test checks `analyzePosition` on real-game positions: never "illegal", and a forced move is always the move that was played.
  - Engine version 0.2.0.

**Evidence**
- `pnpm check`: all green. Engine unit tests: 14 files, 240 tests, statements 94.53% (coverage measured on unit tests). Engine property tests: 6 files, 15 tests. Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `pnpm --filter @retrograde/engine test:slow` (1,106 s, run alongside the review agent): 12/12 passed. Every perft count at depth 5, start position at depth 6 = 119,060,324, 400 long random games, and completeness/soundness over 4 × 12,500 positions. The new slow analyzer-claims property ran separately after the review fixes: 1/1 passed (3,000+ real-game positions at depth 3, as played and with `-` fields; 846 s).
- **Self-review** (separate review agent): no soundness bugs. Its probes found 0 failures over 75,285 moves from 4,000 hand-built positions, and no false "illegal" or wrong forced move in 1,828 real-game positions. Fixed:
  - A forced move that could be en passant *or* an ordinary capture was reported as definitely en passant (a false deduction). Now it reads "capturing a black pawn (possibly en passant), …", with a regression test.
  - Added the analyzer-claims property test (fast and slow).
  - Added "does not fire" tests for `LAST_MOVE_FORCED` and `CAPTURES_REQUIRED`.
  - Property failures now print their seed (see DECISIONS.md).
  - Corrected the parity explanation in SPEC, the fixtures and the learning note.
  - Lazy prior positions now pick "the first king" in the same order as `parseFen`.

**Known issues / follow-ups**
- Positions that are legal can only be reported as "undecided" until the Phase 3 solver finds proof games. The "legal" fixtures assert "not illegal" now, and Phase 3 tightens them to `legal`.
- `pnpm check` takes about 1 minute (the engine's property tests are about 40 s of it). The slow suite takes about 15–20 minutes and runs nightly in CI.
- The `NO_POSSIBLE_HISTORY` message says "checked 3 moves deep", following SPEC's example text, but the depth counts single moves (plies), not move pairs.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests (unit tests with coverage, then the property tests):
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Tests  240 passed` with `Statements : 94.53%`, then `Tests  15 passed`.
2. Ask the analyzer about some positions:
   ```powershell
   cd packages/engine
   npx tsx -e "import { analyzePosition, parseFen } from './src/index'; for (const f of ['7k/8/8/8/8/8/PPP5/KB6 b - - 0 1', 'k7/8/8/8/8/PP6/PP6/K7 w - - 0 1', '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1', 'r3k2r/pppp1ppp/4p3/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1']) { const p = parseFen(f); if (p.ok) { const r = analyzePosition(p.value); console.log(f, '->', r.verdict.kind); for (const x of r.verdict.findings) console.log('   ', x.rule + ':', x.message); } }"
   cd ../..
   ```
   You should see:
   - "There's no move White could have just played to reach this position." (the walled-in king);
   - "3 white pawns (a2, b2, a3) could only have started on the a- and b-files, so the pawn on a3 has no possible starting file.";
   - "Black's last move must have been …Kh8-g8, possibly capturing a white knight, bishop, rook or queen.";
   - the `NO_POSSIBLE_HISTORY` message for the last position.
3. Regenerate the cross-language replay vectors (should leave no diff):
   ```powershell
   pnpm --filter @retrograde/engine fixtures
   git status --short fixtures
   ```
4. Optional, about 15–20 minutes: `pnpm --filter @retrograde/engine test:slow` should end with every test passed.
5. `pnpm check` should pass.

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
