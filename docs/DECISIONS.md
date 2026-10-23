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
  14. **Guest sessions (§10.4).** ~~Both `GET /daily` and `GET /daily/{number}` create a guest session when there isn't one, so archive links work for new visitors.~~ Superseded 2026-10-23 ("Phase 6 API decisions"): GETs create nothing; `POST /daily/{number}/start` creates the guest player, session and attempt.
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

## 2026-10-22: En passant in retro analysis and in the hash
- Context: Reviewing the Phase 1 plan. A FEN en passant field of `-` is ambiguous: many FENs (hand-typed ones, and some tools') write `-` even right after a double push. A strict comparison would wrongly rule out a double push as the last move, e.g. …e7-e5 in `rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2`, which could even make a legal position look illegal.
- Decision:
  - **Retractions (§5.3 step 3):** an en passant field of `-` means "not stated". The forward-generation check compares placement and side to move, and compares the en passant square only when P states one (rule 2 then allows only the matching double push). The §5.5 fixture after 1.e4 e5 keeps …e7-e5 as a possible last move.
  - **Zobrist (§4.5):** the en passant file is hashed only when a pawn of the side to move could capture en passant (pseudo-legally, ignoring pins), as Stockfish does. Positions that differ only by an unusable en passant square hash the same; a test pins this down.
  - **FEN output:** `makeMove` records the en passant square after every double push and `toFen` writes it (standard FEN convention).
- Consequences: Better transposition merging in the solver. `toFen` output and the hash deliberately disagree about unusable en passant squares; anything comparing positions for identity uses the hash or the target key, not FEN strings.

## 2026-10-22: Phase 1 engine decisions
- Castling is generated only when the right is in the castling flags **and** the king and that rook stand on their home squares, the squares between them are empty, the king isn't in check, and it doesn't pass through or land on an attacked square. Castling flags and the en passant square from a FEN are never trusted on their own, so syntactically valid but illegal positions (no king, two kings, a pawn on its first rank, stale rights) never crash move generation.
- Perft adds chessprogramming.org's **Position 6** (`r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10`: 46 / 2,079 / 89,890 / 3,894,594 / 164,075,551), copied from the Perft Results page, which also confirms every number in the §4.7 table. Fast-suite depths (largest depth with ≤ ~500,000 nodes): start d4, Kiwipete d3, Pos 3 d4 (d5 is 674,624), Pos 4 d4, Pos 5 d3, Pos 6 d3. The slow suite runs d5 for all six plus the start position at d6.
- New dev dependencies: fast-check 4.10.2 (property tests, SPEC §3.4) and @vitest/coverage-v8 5.0.5 (enforces §11.2's 90% engine statement coverage in the engine's `test` script).

## 2026-10-22: Engine implementation choices (Phase 1)
- **Non-null assertions in engine source.** The engine exports TypeScript source, so every consumer (generator, web) type-checks it with the repo-wide `noUncheckedIndexedAccess`. Turning the flag off for the engine alone doesn't work, and turning it off everywhere would weaken the other packages. Hot-path typed-array reads whose index is already proven in range (the `sq & 0x88` test, fixed-size key tables, the undo stack) use `x[i]!`, which costs nothing at runtime. ESLint's `no-non-null-assertion` is switched off for `packages/engine/src` only. Reads that can genuinely be missing, like optional regex groups, keep their `undefined` checks.
- **Legality shortcut.** Pseudo-legal moves are filtered by make, test and unmake, as SPEC §4.3 says. When the side to move isn't in check, a non-king, non-en-passant move whose piece isn't on a rank, file or diagonal with its own king can't be pinned, so it skips that test. This took perft from ~2.5M to ~4M nodes/s. Perft and the property tests cover it.
- **Shared scratch buffer.** `legalMoves` and `hasLegalMove` reuse one module-level move buffer instead of allocating 8 KB per call. This is safe because move generation never calls either function and both finish with the buffer before returning.
- **Property-test sizes.** The fast suite plays 20 seeded random games of up to 120 plies (over 1,500 positions, checking every legal move in each). The slow suite plays 400 games of up to 200 plies. Random play favours en passant, castling and promotions, and the fast test asserts each one actually happens.
- **Positions with several kings of one colour** (illegal, but the Lab can show them): legality is judged against one tracked king per side, the first one found when parsing. Castling additionally checks its own destination square, so it never lands on an attacked square whichever king is tracked. The property tests run random play from such positions to make sure nothing crashes and every invariant still holds.
- **SAN reading** rejects an `x` on a move that captures nothing (`Nxf3` from the start position). All other leniencies are listed in `sanToMove`'s doc comment.

## 2026-10-22: Phase 2 retro-analysis decisions
- Context: Writing the Phase 2 plan. The owner approved all of the following; SPEC §5.2, §5.2.1, §5.3 and §5.4 now hold the settled versions.
- Decision:
  1. **Stated castling rights constrain the last move.** The forward check in §5.3 step 3 requires the move to keep every castling right the position states. A stated right says king and rook never moved, so they can't have made the last move. This mirrors the en passant rule: stated fields are claims, `-` claims nothing.
  2. **`NO_POSSIBLE_HISTORY`** (illegal) is a new rule for "every possible last move leads back to a dead end within the analysed depth". `NO_POSSIBLE_LAST_MOVE` stays the depth-1 rule.
  3. **Three-state viability.** Results are viable, not viable or unknown (limit hit). Claims (`NO_POSSIBLE_HISTORY`, `LAST_MOVE_FORCED`) are made only from definite results. Depth 1 is always decided, so `NO_POSSIBLE_LAST_MOVE` is too.
  4. **Pawn matching** uses an exact bitmask dynamic program instead of the Hungarian algorithm (same minimum, simpler code, at most 2^8 x 8 steps), plus a maximum matching whose alternating paths give the Hall-violating group named in `PAWN_STRUCTURE_IMPOSSIBLE` messages.
  5. **Faster forward check.** It generates only the moved piece's legal moves (plus castling for a king) instead of all of P′'s. It is still forward generation, so still sound. The soundness property test uses the full generator independently.
  6. **"Legal" fixtures before the solver.** In Phase 2, fixtures whose expected verdict is `legal` assert "not illegal" plus their specific last moves. Phase 3 tightens them to `legal` with a proof.
  7. **Unknowable fields of prior positions.** Prior positions get halfmove clock 0 and a move number one lower when Black is the retractor (minimum 1). `analyzePosition` defaults to depth 3, 2,000 ms and 200,000 nodes. Viability is cached by an exact key (placement, side, castling, en passant), never by hash alone.
- Consequences: More positions are recognised as illegal (via castling claims and deeper dead ends), and nothing is claimed beyond what was fully searched.

## 2026-10-22: Phase 2 implementation choices
- **Test layout for speed.**
  - The engine's `test` script runs the unit tests with coverage (94% statements on their own), then the property tests without coverage. Coverage instrumentation made the property tests about 3x slower, and `pnpm check` went from about 44 s to 112 s.
  - The completeness and soundness property tests are split into four files (fast: 4 × 500 positions; slow: 4 × 12,500) so Vitest runs them in parallel.
  - Soundness is checked for every retraction of every visited random position (2,000 fast / 50,000 slow). Completeness is checked for every legal move from each of those positions.
- **Random play** (`src/util/random-game.ts`, shared by tests and the fixture script) favours en passant ×40, castling ×20, promotions ×10 (underpromotions ×15), captures ×3, pawn pushes ×3 and moves off the back rank ×3. Without the last two, 500-position samples sometimes contained no promotion or no castling. The Phase 4 generator tunes its own weights (SPEC §7.2).
- **Retraction generator internals.**
  - Candidates are tested on one scratch position: apply at most four square changes, check, revert.
  - The forward check finds the move in the piece's pseudo-legal moves, then makes it once to test both legality and the result.
  - Prior positions are built lazily, on first access.
  - Together these made `retractions()` about 5x faster.
  - `clonePosition` now copies only the used part of the undo stack.
- **Replay vectors** (`fixtures/replay-vectors.json`):
  - 520 legal games (1–160 plies) and 132 illegal ones covering six kinds: self-check, disallowed castling, a stale move, a needless promotion piece, an unreachable square, and a missing promotion piece. The missing-promotion vectors are taken from promotions actually played, since random plies rarely land on one.
  - One game per line, so diffs stay readable. The file is ignored by Prettier.
  - Cross-checked once with python-chess (0 mismatches in 652 games).
  - An engine test fails if the file is stale or was produced by another engine version.
- **Seeds in property tests.** The completeness and soundness tests iterate fixed seed ranges directly (each seed is a whole random game, so fast-check's shrinking would only replay games), and every failure message starts with its seed. The analyzer-claims property (random-game positions are never called illegal, and a forced last move names the move played) uses fast-check with a fixed seed, as `.claude/rules/engine.md` asks.
- **Forced moves that may be en passant.** When a forced last move could be en passant *or* an ordinary capture, the message says "capturing a black pawn (possibly en passant), knight, …". It never claims en passant unless that is the only possibility.

## 2026-10-22: Phase 3 solver decisions
- Context: Writing the Phase 3 plan. The owner approved all of the following; SPEC §5.1, §6.1, §6.3 and §6.4 hold the settled versions.
- Decision:
  1. **Promotion-aware lower bound.** A non-pawn target piece may be explained as a promoted pawn at cost 0, at most E = (current pawns − target pawns) times per type. A forced per-type matching overestimates: a far-away knight versus a pawn one move from promoting on the target square, with the old knight captured later. A dedicated test pins down that counterexample. The admissibility property test asserts that its games include a promotion to a piece type the side already had, with the original piece captured later.
  2. **Light- and dark-squared bishops are separate types in the matching**, since a bishop never changes square colour.
  3. **Claim options.** `castling` (rights that must survive to the end) and `enPassant` (the final en passant square) serve `analyzePosition`'s proofs. Daily puzzles compare the target key only. A lost required right prunes immediately.
  4. **`analyzePosition` decides "legal" only with a proof**, from a quick `shortestProofGame` attempt (defaults: 10 plies, 750 ms, 1,000,000 nodes). The proof is replayed as a self-check. Otherwise the verdict stays `undecided` (`search-limit` if anything was cut short, else `no-contradiction-found`).
  5. **Types and semantics.** `ShortestResult` is `{ status, plies, solution, nodes, elapsedMs, searched }`. `count` is exact only when the status is `complete` and the count is below `cap`. Repetition and the 50-move rule are ignored.
  6. **Performance.** The pawn part of the bound is cached by pawn configuration (most moves don't move a pawn); other types use small exact enumerations or a bitmask DP. The transposition table is a fixed-size typed-array table keyed by the full 64-bit Zobrist hash plus remaining plies, 2^20 entries by default (`ttBits`).
  7. **Test budget.** `pnpm check` stays under about two minutes; heavy checks (100,000-game admissibility, N = 5 brute force, 20 targets per N) run in the slow suite.
- Consequences: The bound stays admissible with promotions. Legal Lab positions within 10 plies get a proof and verdict `legal`.

## 2026-10-22: Phase 3 implementation choices
- **Limit checks on the first node and every 256 nodes after** (SPEC §6.4 says 50,000). Progress is still reported about every 50,000 nodes. A find-mode node evaluates the bound for every child (about 80 µs), so even a 4,096-node interval overshot a 750 ms budget (813 ms measured in self-review). `shortestProofGame` also stops before starting another length once its budget is spent. `Date.now()` is negligible next to a node.
- **Default table size `ttBits = min(20, 12 + plies)`**: 2^20 entries, about 13 MB, for 8+ plies, and much smaller tables for short searches. This keeps thousands of easy solves (the brute-force cross-check, Lab analysis) from allocating 13 MB each. `shortestProofGame` creates its table only when it actually searches, and shares it across the lengths it tries; an entry ("solutions from this node with r plies left") doesn't depend on the total length or on find-mode caps.
- **Pawn matching shortcut.** A pawn already on a target pawn square is matched to it before the bitmask DP. This is exact: an exchange argument shows some cheapest matching contains every such pair, because pawn distance obeys the triangle inequality (going through the target square is a valid path). It made pawn-heavy bounds about 4x faster.
- **Allocation-free bound on cache hits.** It uses typed arrays and dedicated 1- and 2-piece paths, with no closures on the hot path (the TypeScript runner wraps every closure creation in a helper call). The general assignment DP only runs with 3+ pieces of one kind, which needs promotions.
- **Test layout.** Heavier solver checks (brute force at N ≤ 4, random targets to N = 10, the tiny-table count, limits) live in `*properties*` files, which run without coverage instrumentation. The 50,000-node progress test, 100,000-game admissibility and N = 5 brute force are in the slow suite. `pnpm check` measured 100 s.

## 2026-10-22: Phase 4 generator decisions
- Context: Writing the Phase 4 plan. The owner approved all of the following; SPEC §7.1 and §7.2 hold the settled versions.
- Decision:
  1. **Beam search as the main candidate source.** Puzzles grow one ply at a time from accepted puzzles. The basis: a prefix of a unique shortest proof game is the unique shortest proof game for its full position, and for the target key the argument fails only when the last move is castling or en passant. The frontier is diverse (child and prefix caps), favours tactical and special moves, and excludes plain king walks. §7.2's biased random games remain a second source.
  2. **Every candidate is still verified fully by the solver**, uniqueness first (it fails most often and stops at the second solution), then the exhaustive shortest checks. Only `complete` results count.
  3. **Node limits, never time limits**, so output is byte-identical for a seed and engine version whatever `--jobs` is.
  4. **Measure before building.** Before the pool is built, the checks are timed on real candidates per ply count and the total time projected; the incremental bound comes first if that projection is too slow (over about 1 hour on 4 jobs, or a shortest-check p95 over about 2 s at any N).
  5. **External check.** The brute force for N ≤ 5 is compared with wismuth.com's diagram statistics. There a "diagram" is the 64 squares only, but with exactly N plies from the start the side to move is fixed by parity, so per N it equals our target key. "Uniquely realizable" means exactly one N-ply game (no shortest requirement); we report our "unique shortest" count beside it.
  6. **Pool selection** uses per-ply quotas and at most 3 puzzles per 6-ply prefix. The end-of-phase report shows 2 sample puzzles per star level (target FEN, plies, solution in SAN).
  7. CLAUDE.md's generator command gets its missing `generate` subcommand (Phase 0 item 8).
- Consequences: The 4–5 star levels become reachable; output is reproducible on any machine and any job count.

## 2026-10-23: Phase 4 implementation choices
- Context: Building the generator. The owner's rule from the plan: measure the checks on real candidates first, and do the incremental bound first if the projection is too slow.
- **Measurement, then the incremental bound.** The first measurement (beam W = 20, one thread, engine 0.3.0) failed the agreed threshold: at N = 9 the median candidate took 308 ms and the p95 11.7 s. A profile of a heavy 8-ply uniqueness count (118,811 nodes) showed half the solver's time rebuilding the bound's piece lists from the board for every child. The bound is now **incremental** (`createIncrementalBound`): the search pushes and pops moves, and only the 1–3 lists a move touches change; per-kind costs are memoized on a list version number. Same node counts, 2,328 ms → 1,250 ms on that search (1.86×). A property test compares it with a from-scratch bound through push and pop (1,500 games fast, 100,000 slow).
- **Other engine changes (engine 0.4.0).**
  - Distances avoid **frozen pawns**: target pawns on their start rank, which never moved and can't be captured. This made no measurable difference to node counts on beam candidates, but it is admissible, cheap (one table per kind and square, built once per target), and it proves a bishop shut in behind such pawns unreachable. Kept, with a unit test.
  - **One-ply-left shortcut**: with one ply left, only a move between two of the (at most 4) squares that differ from the target can finish, so the bound isn't evaluated for those children.
  - **Transposition tables are pooled** and cleared in O(1) with a generation counter, instead of allocating up to about 17 MB per solve (16 bytes an entry with the generation array). The pool keeps up to 2 tables per size alive for the life of the thread, the Lab's web worker included: at most about 34 MB at the largest size.
  - `minimumPlies(target)` is public (the lower bound from the start, with the right parity).
- **A free non-uniqueness test before any search.** If the last move can be played at one of the same side's earlier turns (that side's later moves each move one turn on, the opponent's stay put) and the game still reaches the target, there are two solutions. It's sound, never complete, so passing it still means the full check. Most rejections now cost about 0.1 ms.
- **Beam details.** Per parent, after the free test, the 8 most interesting extensions are verified (`--children`), or more while the frontier is small, so that about W × 8 candidates are verified per ply. The frontier keeps W = 180 (`--width`), at most max(3, W / parents) children per parent, and at most W/6, W/12, W/15 and 2 puzzles sharing their first 1, 2, 4 and 6 plies. Two pool runs showed why each cap is needed:
  - The first run (W = 60, no 6-ply cap) found 0 puzzles for the 9–12-ply quotas. Every long puzzle descended from one of only 60 six-ply games, so the pool's cap of 3 per 6-ply prefix ran out on the short quotas. The pool now also fills its quotas longest first.
  - The second run (W = 180) grew all 500 puzzles from 3 first moves (345 began 1.e4). The "3 children per parent" cap also applied to the start position, so only 3 first moves ever entered the frontier. Hence the scaled per-parent cap and the 1- and 2-ply caps.
- **Node limit 200,000 per search** (`--node-limit`, also `verify`'s default, which must be at least the limit the pool was made with). With 100,000 the W = 180 run took 29 minutes but found only 112 of the 140 puzzles wanted at 10–11 plies and 45 of 70 at 12, because 35–43% of the candidates there hit the limit. With 200,000 and the diversity fixes below, the pool run took 72 minutes on the owner's 2-core laptop (`--jobs 4`) and filled every quota except 10–11 plies (131 of 140; the pool tops up with shorter puzzles). That's over the "about 1 hour" guideline from the plan, but it's a one-off build of a committed file, and the incremental bound the guideline asked for is done. Candidates that hit the limit are still discarded, so the long puzzles are biased towards ones the solver can prove quickly.
- **Difficulty uses the uniqueness count's nodes** (`solverNodes`), not a separate find-one search (SPEC §7.3 changed). It measures the same thing (how hard it is for a solver to pin down the game) and saves a third search per accepted puzzle.
- **Feature definitions** (SPEC §7.3): pieces are tracked by identity. An immediate back-and-forth counts as `tempo`, not `switchback`; `switchback` is a return by another way; `king-walk` counts one side's king moves (castling not included); `phoenix` is a promotion to a type of which an original piece of the same side is captured anywhere in the game.
- **Ply ranges beyond 5–12.** `--min-plies` / `--max-plies` outside the standard quotas stretch the nearest quota (e.g. `--min-plies 3` makes the 5–6 quota 3–6), and topping up uses the whole requested range. Found in self-review: shorter or longer puzzles were silently dropped.
- **Random-source weights** stay at §7.2's starting values. Random games contribute very little (0.15% acceptance in the first run); they remain as the source for puzzles that end in castling or en passant.
- **Output.** The JSONL holds only deterministic fields; timings go to a separate `<out>.stats.json`. Ids are `g{seed}-{index:06}`, random candidates are indexed from 1,000,000, and lines are sorted by index. CLI paths resolve against the directory the command was run from (`INIT_CWD`), since `pnpm --filter` runs scripts inside `apps/generator`.
- Consequences: The pool reaches 12 plies in about 72 minutes on the owner's 2-core laptop. Generator output depends on the engine version, so `verify` compares `solverNodes` only for puzzles made by the same engine version (for older ones it recomputes the score from the stored `solverNodes`).

## 2026-10-23: Fast suite trimmed so `pnpm check` stays under about 90 s
- Context: After Phase 4, `pnpm check` took 110–150 s on the owner's laptop. The owner asked for about 90 s, leaving room for the Phase 5 web tests.
- Decision: The fast suite keeps smaller versions of the heavy property runs. The full sizes are in the nightly slow suites, which already held larger versions of each.

  | Test | Fast before | Fast now | Slow suite |
  |---|---|---|---|
  | Retraction completeness | 4 × 500 positions | 2 × 150 | 4 × 12,500 |
  | Bound admissibility | 5,000 games, 1,500 with the incremental-bound check | 1,500 games, 500 with the check | 100,000, all with the check |
  | Analyzer claims | 6 runs | 2 runs | larger run |
  | Engine round-trips | 20 games | 8 games | 400 games |
  | Solver vs. brute force | every 3-ply target; 500 sampled at 4 plies | 1,000 sampled at 3 plies; 150 at 4 | every 3-ply target; 500 at 4 and at 5 plies |
  | Wismuth diagram statistics | N ≤ 4 | N ≤ 3 | N ≤ 5 |
  | Generator: `verifyCandidate` vs. brute force | every 150th 4-ply target | every 600th | every 30th, plus `verify` of the whole committed pool (new generator slow suite) |

  The 20-puzzle fixture is now cut from puzzles cheap to solve.
- Consequences: `pnpm check` measured 72 s warm (lint 17 s, typecheck 9 s, tests 38 s, Go 6 s, hooks 1 s). Nightly CI also runs `pnpm --filter @retrograde/generator test:slow` (about 4 minutes).

## 2026-10-23: Phase 5 web shell and Lab decisions
- Context: Phase 5 plan, approved by the owner with all five proposals and three additions (rename the "two moves back" example; a CSP-friendly theme bootstrap; Copy link and Open in Lichess buttons).
- **New dependencies** (exact versions; all GPL-compatible):

  | Package | Version | License | Kind |
  |---|---|---|---|
  | react-router | 8.5.0 | MIT | runtime |
  | chessground | 9.2.1 | GPL-3.0-or-later | runtime |
  | comlink | 4.4.2 | Apache-2.0 | runtime |
  | @fontsource-variable/fraunces, @fontsource-variable/inter | 5.3.0 | OFL-1.1 | runtime (fonts) |
  | @fontsource/ibm-plex-mono | 5.3.0 | OFL-1.1 | runtime (fonts) |
  | tailwindcss, @tailwindcss/vite | 4.3.3 | MIT | dev |
  | @playwright/test | 1.64.1 | Apache-2.0 | dev |
  | @axe-core/playwright | 4.14.0 | MPL-2.0 | dev |

  `@retrograde/engine` is now a dependency of the web app. Playwright's Chromium is a one-time download (`pnpm --filter @retrograde/web exec playwright install chromium`).
- **Piece set: cburnett**, as shipped inside chessground 9.2.1 (`assets/chessground.cburnett.css`, inline SVG). The pieces are by Colin M.L. Burnett. Lichess's `COPYING.md` (checked 2026-10-23) lists them as **GPLv2+**, which is compatible with this repository's GPL-3.0-or-later. No extra download.
- **Visual design (SPEC §11.4).**
  - Colours are CSS variables, switched by `data-theme` on `<html>` and mapped into Tailwind:
    - light "paper": #F4EDE0, cards #FBF7EF, ink #2A241D, accent oxblood #8C2F2B;
    - dark "ink": #15181D, cards #1E232A, parchment text #E9E1D2, accent #D0695F.
  - Type: Fraunces (headings), Inter (interface), IBM Plex Mono (FEN, moves).
  - The board's checkerboard is drawn in CSS from the same tokens (light #EADBC0, dark #B08A64; a little darker in dark mode). Coordinates sit inside the board in one dark colour that reads on both square colours.
  - axe finds no serious or critical issues in either theme (e2e).
- **Theme bootstrap without inline script** (owner's addition): `public/theme-init.js`, loaded with a plain `<script src>` in `<head>` (not `async` or `defer`), sets `data-theme` before first paint from `localStorage` or `prefers-color-scheme`. A strict CSP (`script-src 'self'`) needs no `'unsafe-inline'` or hashes. `src/lib/theme.ts` mirrors it, and the header's toggle offers light, system and dark.
- **Lab behaviour.**
  - **Workers:** analysis runs 300 ms after the last edit in an analysis worker, and a newer request terminates and restarts it. Prove runs in a separate prover worker, so analysis keeps working.
  - **Prove:** up to 16 plies with no time limit; Cancel terminates the worker and shows "Cancelled". Progress messages still queued after a cancel are ignored, and leaving the position stops its search.
  - **Notes:** findings with the same rule are grouped into one note (four "can no longer castle" lines become one note).
  - **Keyboard editing:** the FEN field (missing trailing fields default to `w - -`), plus click-to-place. A palette piece arms 64 square buttons over the board, which a click, a tap or Tab + Enter place on; Escape disarms.
  - **Links:** edits replace the history entry; take-backs and examples push one, so Back undoes them.
  - **Copy link and Open in Lichess** (owner's addition). Lichess's board editor URL is `https://lichess.org/editor/<FEN with spaces as underscores>`.
  - **Stale report:** while a new analysis runs, the previous report stays visible but dimmed and `inert`, so nothing in it can act on the wrong position.
  - **No auto-castle:** chessground's `autoCastle` is off; a king dragged two squares moves alone.
  - **Remeasure on pointer-down:** chessground refreshes its cached board position only on scroll and resize, so after a layout shift (late web fonts) it could drop pieces on the wrong square. The board clears that cache on every pointer-down and before a palette drag (found by a flaky CI run after the `phase-5` tag; regression test in `lab.spec.ts`).
  - **Broken worker:** a worker that fails to load or crashes rejects its pending calls instead of hanging.
  - **Prove announcements:** screen readers hear only the length being searched and the outcome, not every node-count update.
  - The pages that need the API are explanatory placeholders. Login and register show the disabled form layout.
- **Engine: `onProgress` reports the ply count being searched** (`plies`), including when each length starts. It's additive and changes no output, so the engine stays at 0.4.0.
- **Testing.**
  - Component tests mock `Board`, because chessground needs layout jsdom lacks. They render real engine reports.
  - Worker-protocol and Lab-state tests run in Node instead of jsdom, which halved the web suite's time.
  - The client's cancel-by-terminate is tested with a `MessageChannel` standing in for the worker.
  - Playwright runs against the production build (`vite build` + `vite preview`, with no API proxy when `E2E=1`). `pnpm --filter @retrograde/web shots` writes 44 screenshots (11 states × 360/1280 px × light/dark) for visual review; they're gitignored. 4 final ones are committed in `docs/screenshots/`.
  - CI's Ubuntu job installs Chromium and runs `pnpm test:e2e`.
- **Lint caches.** `pnpm lint` uses ESLint's and Prettier's caches (in `node_modules/.cache/`), so a warm run takes 5 s instead of 25 s, and `pnpm check` 71 s. Caveat: ESLint's cache doesn't re-check an unchanged file when a type it imports changes. CI lints from scratch, so it still catches those.
- **CSP note for Phase 9:** the piece images are `data:` SVG URIs (in chessground's CSS), so the policy needs `img-src 'self' data:` (SPEC §11.1 updated). Same-origin module workers and CSSOM style changes are allowed under `'self'`.
- Consequences: the Lab works offline in the browser, with no server. Main bundle 116.65 KB gzip (`/lab`: about 144 KB of JS); the engine worker is a separate file, 44 KB raw (16.5 KB gzip).

## 2026-10-23: Phase 6 API decisions
- Context: Phase 6 plan, approved by the owner with two changes (`LAUNCH_DATE` for local development; side-effect-free GETs with an explicit start).
- **GETs are side-effect free; `POST /daily/{number}/start` starts an attempt** (supersedes decision 14).
  - `GET /daily` and `GET /daily/{number}` return the puzzle, plus the caller's attempt if they already have a session, and create nothing: no player, session, attempt or cookie.
  - `POST /daily/{number}/start`, which the web app calls when it shows the puzzle, creates the guest player and session if needed and the attempt with `started_at` (the leaderboard's start time, SPEC §8.5). It's idempotent: a second call returns the same attempt and keeps the first `started_at`.
  - A guess or hint without a started attempt is a 409 with a problem explaining that `/start` comes first.
  - Rate limit on `/start`: 300 per IP per hour. That's generous because many real users share an IP (mobile carrier NAT, campus networks), so the planned 20-new-guests-per-IP cap is dropped.
  - The 30-day guest cleanup stays (below).
- **Puzzle numbers:** `number = days since LAUNCH_DATE + 1`; `schedule` rejects days before `LAUNCH_DATE`. `LAUNCH_DATE` defaults to 2026-11-01 (the planned launch). For local development, `pnpm seed` writes `LAUNCH_DATE` to `.env` as 14 days before today when `.env` doesn't have it (and says so), then schedules from `LAUNCH_DATE` through 30 days ahead. Phase 7 gets past puzzles for the archive.
- **Cleanup:** `retrograde cleanup`, and the same job inside `serve` at startup and every hour. It deletes:
  - expired sessions;
  - guest players (no user) older than 30 days with no guesses (their attempts, sessions and stats cascade).

  A guest with a guess is kept.
- **Chess library:** `github.com/corentings/chess/v2` v2.6.0, MIT (GPL-compatible). The adapter (`internal/chessrules`) works on positions, not on the library's `Game`, so draw rules (fivefold repetition, the 75-move rule) never end a game, matching the engine. It enforces the engine's UCI rules itself. It agrees with all 652 replay vectors. The vectors now also carry each legal game's SAN, and the Go SAN matches the engine's on every move (hint 3 shows SAN from Go; the web app writes SAN with the engine).
- **Feedback vectors** (`fixtures/feedback-vectors.json`, SPEC §8.3) are generated by the engine's fixtures script from a TypeScript reference implementation, the same "never hand-edit fixtures" rule as the replay vectors. They're the 3 SPEC examples plus 11 more.
- **Request validation from the contract:** `github.com/oapi-codegen/nethttp-middleware` (Apache-2.0) with `github.com/getkin/kin-openapi` (MIT) validates every request against `api/openapi.yaml`: unknown fields (`additionalProperties: false`), lengths, patterns and enums. The generated strict server uses `github.com/oapi-codegen/runtime` (Apache-2.0). Passwords use argon2id from `golang.org/x/crypto` (BSD-3-Clause).
- **Sessions:** the sliding expiry is written at most once an hour per session, not on every request.
- **Integration tests:** each runs in a fresh, migrated schema in `retrograde_test`, dropped afterwards, so tests are isolated and can run in parallel.
- **Response shapes:**
  - Hints are typed objects:
    - `movers`: `{white, black}` piece types;
    - `captures`: `{plies}`;
    - `move`: `{ply, uci, san}`.
  - A 422 for an illegal move includes the ply; a 429 includes `Retry-After`.
- **Schema additions to SPEC §10.3:**
  - `player_stats.hints_total`, for the profile's average hints;
  - `attempts.hint_move_ply`: hint 3 reveals the solution move at the first non-green ply of the latest guess *when the hint was taken*. The ply is stored, so the hint doesn't change with later guesses;
  - indexes for the daily leaderboard, session expiry and guest cleanup.
- **Guess validation details:**
  - A malformed move (not `^[a-h][1-8][a-h][1-8][qrbn]?$`) is a 422 with its `ply`, like an illegal one, not a 400. The contract only caps each move at 5 characters, so the player is told which move is wrong.
  - Every `ply` in the API is 1-based: the 422's `ply`, hint 2's `plies` and hint 3's `ply`.
  - A rejected guess (wrong length, illegal or malformed move, over 40 moves) doesn't use one of the six guesses.
- **Archive attempts count in no stats** (a deviation that extends SPEC §1 and §8.7, which only exclude them from streaks and leaderboards):
  - An attempt started after its puzzle's day is practice. It is also left out of played, solved, win rate, the guess distribution and average hints, so the stats describe daily play only and can't be padded by replaying the archive.
  - The flag is fixed when the attempt starts, so an attempt started at 23:59 and finished after midnight still counts for its puzzle's day.
- **Streaks:**
  - A failed daily after the last solve ends the current streak at once (Wordle-style; SPEC §8.5 "consecutive days with a solved daily"). The max streak is kept.
  - Otherwise the stored streak is as of the last solve, and it's applied at read time: `/auth/me`, profiles and the all-time leaderboard show it only while the last solve was today or yesterday (today's puzzle may still be ahead).
- **CSRF origin:** `BASE_URL` is normalized the way browsers write `Origin`: lower case, no default port. So `https://example.com:443` still accepts the browser's `Origin: https://example.com`.
- **Timestamps in UTC:** the store scans `timestamptz` as UTC, so API timestamps don't depend on the server's time zone.
- **Local tooling:**
  - `pnpm seed` appends `LAUNCH_DATE` to `.env` (with a comment) only when it's missing, then runs `migrate`, `import-puzzles` and `schedule`, which are all idempotent.
  - `pnpm try:api` builds the API into a temporary folder and runs it on port 8091 with `BASE_URL=http://127.0.0.1:8091`, so it works while `pnpm dev` is running and needs no curl. It never prints the session token or the password.
- **Transitive Go modules** that come with the new dependencies are all MIT, BSD-3-Clause or Apache-2.0, all GPL-3.0-compatible:
  - `gorilla/mux`, `google/uuid`, `go-openapi/jsonpointer`, `santhosh-tekuri/jsonschema`, `oasdiff/yaml`, `oasdiff/yaml3`, `apapsch/go-jsonmerge`, `rogpeppe/go-internal`;
  - `golang.org/x/sys`.
- Consequences: crawlers and bots that only `GET` the daily create no rows at all. The web app must call `/start` before the first guess or hint (Phase 7).
