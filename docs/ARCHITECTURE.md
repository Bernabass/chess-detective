# Retrograde architecture

How Retrograde works and why it is built this way. Code comments refer to the numbered sections here (for example `ARCHITECTURE.md §6.3`).

## Contents

1. Overview
2. Glossary and conventions
3. System architecture
4. Engine core
5. Retro analysis
6. Proof-game solver
7. Puzzle generator
8. Daily Proof Game
9. Lab
10. Backend: API and data model
11. Quality: security, testing, CI, accessibility, deployment
12. Ideas for later
13. References

---

## 1. Overview

Ordinary chess puzzles ask "what's the best move?". Retrograde asks "**what happened?**". Players look at a position and reason backwards like a detective: which move was played last, whether the position could ever arise, and how a game reached it in exactly N moves.

- **Lab.** A board editor where anyone can set up or paste a position. The engine explains whether the position is legal, lists the possible last moves, writes "detective notes" (deductions such as "at least one white bishop is a promoted pawn") and can prove legality by finding a game that reaches the position. It runs entirely in the browser.
- **Daily Proof Game.** One puzzle a day for everyone: reach the target position from the starting position in exactly N plies. Six guesses, Wordle-style per-ply feedback, three optional hints, a share card and streaks.
- **Accounts and leaderboards.** Username and password, or Sign in with Lichess. Guests can play without an account, and their results move to the account when they sign up. Daily and all-time leaderboards, public profiles.
- **Archive.** Past daily puzzles are playable in practice mode, which affects no streak, statistic or leaderboard.

---

## 2. Glossary and conventions

| Term | Meaning |
|---|---|
| **Ply** | One move by one side. Every length inside the code is in plies. |
| **Move-count notation** | Problemists write "proof game in 4.5": 4 full moves plus one White move, 9 plies. `plies = round(moves × 2)`, so 4.0 is 8 plies and 4.5 is 9. The UI shows both ("4.5 moves · 9 plies"). |
| **Proof game** | A legal game from the initial position that ends in a given position after a given number of plies, proving the position can arise. |
| **Shortest proof game** | A proof game with no shorter proof game. |
| **Unique / dual** | A puzzle is *unique* if exactly one move sequence of the stated length reaches the target; extra solutions are *duals*. Daily puzzles are unique shortest proof games. |
| **Retraction (un-move)** | Taking a move back: for a position P, the positions P′ and moves m such that playing m in P′ gives P. |
| **Un-capture / un-promotion** | A retraction that puts a captured piece back / turns a piece on the last rank back into a pawn. |
| **Retractor** | The side *not* to move in P, which made the last move. |
| **Target key** | FEN piece placement plus side to move, e.g. `rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w`. Daily targets are compared by target key only, as in proof-game problems: castling rights, en passant and clocks are ignored. |
| **Verdict** | The Lab's result: `illegal` (proved by a rule), `legal` (proved by a proof game) or `undecided` (nothing proved within the limits). |

Conventions:
- Squares are `a1`..`h8`. Moves on the wire and in storage are UCI: `e2e4`, `e7e8q`, castling as the king's move `e1g1`.
- White moves first, so after N plies White is to move if N is even and Black if N is odd.
- A "day" is a UTC calendar day. Puzzle #1 is released on the UTC date `LAUNCH_DATE`, and `number = days since LAUNCH_DATE + 1`. Players far from UTC see the new puzzle at a fixed local time, not at their midnight.

---

## 3. System architecture

### 3.1 Overview

```
 Browser
 ┌──────────────────────────────────────┐
 │ React app (apps/web)                 │
 │  ├─ chessground board                │
 │  └─ Web Workers ── engine (TS)       │  Lab: analysis, retractions, solver
 └───────────────┬──────────────────────┘
                 │ JSON over HTTPS (/api/*), session cookie
 ┌───────────────▼──────────────────────┐      ┌────────────┐
 │ Go API (services/api)                │─────▶│ PostgreSQL │
 │  ├─ auth, sessions, guests           │      └────────────┘
 │  ├─ daily: guesses, feedback, hints  │─────▶ lichess.org (OAuth only)
 │  ├─ leaderboards, stats              │
 │  └─ serves the built web app         │
 └───────────────▲──────────────────────┘
                 │ JSONL import (CLI subcommand)
 ┌───────────────┴──────────────────────┐
 │ Generator (apps/generator)           │  Node CLI using the TS engine
 └──────────────────────────────────────┘
```

In production the web app is static files on Vercel's CDN, the Go API runs as a Vercel Function, and PostgreSQL is a Neon database; the same API also runs from a container image with the web app embedded (§11.5).

Web routes (React Router, each page loaded lazily so the Lab's board and engine code aren't in the first download):

| Route | Page |
|---|---|
| `/` | Home |
| `/lab` | The Lab (§9); `?fen=` holds the position |
| `/daily`, `/daily/:number` | Today's puzzle, or an earlier one in practice mode (§8) |
| `/archive` | Every released puzzle, newest first (§8.7) |
| `/leaderboard` | Daily and all-time leaderboards (§10.7) |
| `/u/:username` | Public profile (§8.5) |
| `/login`, `/register` | Accounts (§10.6) |
| `/about` | What retrograde analysis is |
| `/privacy` | What is stored, the cookies, and who else processes requests (§11.1) |

### 3.2 Key choices

| Decision | Why |
|---|---|
| Chess and retro engine in **TypeScript** | It must run in the browser (Lab) and in Node (generator). One implementation is one source of truth for the hard algorithms. |
| Backend in **Go** + **PostgreSQL** | Accounts, sessions, leaderboards and keeping the daily solution secret need a server. |
| The server validates guesses with a **Go chess library** | The solution stays on the server, so the server needs move legality. A mature Go library is safer than porting the engine. Cross-language fixtures (§11.2) keep the two rule sets in agreement. |
| **Contract-first API** (`api/openapi.yaml`) | Go server stubs, request validation and TypeScript client types are generated from one file, so they can't drift apart. |
| **Single deployable** | The Go binary embeds the built web app and serves it: one container plus Postgres. |
| Puzzles generated **offline** | Proving uniqueness is expensive. It runs ahead of time in the generator, never at request time. |
| **Windows-first tooling** | Every task is a root `package.json` script backed by Node helpers in `scripts/`, so it works in cmd.exe, PowerShell and bash. No Makefile; LF line endings via `.gitattributes`; CI also runs on Windows. |

### 3.3 Repository layout

```
retrograde/
├─ api/openapi.yaml               API contract
├─ apps/
│  ├─ web/                        React + Vite + TS
│  │  ├─ src/{routes,components,features/{daily,lab},lib,worker}
│  │  └─ e2e/                     Playwright
│  └─ generator/                  Node CLI
├─ packages/engine/               TS chess + retro engine
│  ├─ src/{core,retro,solver,daily,util}/
│  └─ test/
├─ services/api/                  Go module
│  ├─ cmd/retrograde/             subcommands: serve, migrate, import-puzzles, schedule, cleanup
│  ├─ cmd/server/                 the server alone: the entry point Vercel builds
│  ├─ cmd/e2e-setup/              test-only: prepares the e2e database
│  ├─ internal/{config,server,httpapi,auth,lichess,daily,leaderboard,chessrules,ratelimit,store,clock,webui}
│  └─ db/{migrations,queries}/
├─ data/puzzles-v1.jsonl          the committed puzzle pool (§7)
├─ fixtures/                      cross-language test vectors (generated)
├─ scripts/                       cross-platform Node helpers for package.json scripts
├─ docs/                          this document, DEPLOY.md, RUNNING.md, screenshots, demo GIFs
├─ package.json                   root task scripts
├─ vercel.json                    Vercel: the two services, routing, headers, the daily cron
├─ Dockerfile                     the container image (API with the web app embedded)
├─ docker-compose.yml             optional Postgres for development (host port 5433)
└─ .github/workflows/             CI and deployments (ci.yml), loading puzzle data (puzzle-data.yml)
```

### 3.4 Technology choices

Every dependency is pinned to an exact version; upgrades are deliberate commits.

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces: `@retrograde/engine`, `@retrograde/web`, `@retrograde/generator`. Dependency install scripts are blocked except an explicit allow-list (`esbuild`). Freshly published versions are skipped by pnpm's minimum-release-age guard. |
| Node | Current LTS, pinned in `.nvmrc` and `package.json#engines` |
| TS tooling | TypeScript (strict, `noUncheckedIndexedAccess`), ESLint with typescript-eslint, Prettier, Vitest, fast-check. TypeScript stays on the 6.x line until typescript-eslint and openapi-typescript support the native 7.x compiler; `pnpm-workspace.yaml` widens openapi-typescript's TypeScript 5 peer range, and code generation is checked to work with it. |
| Web | React, Vite, React Router, TanStack Query, Tailwind CSS, chessground, Comlink (worker RPC), openapi-typescript + openapi-fetch |
| Go | `net/http` with method-pattern routing; oapi-codegen (strict server) with kin-openapi request validation; pgx v5; sqlc; goose; argon2id from `golang.org/x/crypto`; `github.com/corentings/chess/v2` for move legality. Code generators and golangci-lint are pinned with Go's `tool` directive in `services/api/tools/go.mod` and run with `go tool -modfile=tools/go.mod`, so they need no global install. |
| Database | PostgreSQL with the `citext` extension |
| End-to-end tests | Playwright with axe-core |
| CI | GitHub Actions |
| License | GPL-3.0-or-later for the whole repository, because chessground is GPL-3.0. Every dependency is GPL-compatible (MIT, BSD, Apache-2.0, MPL-2.0, OFL for fonts). |

### 3.5 Development environment

- Windows, Linux and macOS are supported; CI runs on Ubuntu and Windows.
- Tools: Git, the current Node LTS with pnpm, Go, and PostgreSQL with two databases, `retrograde` (development) and `retrograde_test` (integration and end-to-end tests). `pnpm db:up` starts an optional Postgres in Docker instead.
- Settings come from environment variables, falling back to the nearest `.env` file (copy `.env.example`). Go programs read `.env` themselves through a small standard-library parser; real environment variables win, and the process environment is never modified.
- Paths may contain spaces, so every script quotes them.
- `pnpm dev` applies pending migrations as its own first step, then runs the API and the Vite dev server; the server itself never migrates (§10.1). `pnpm build` and `pnpm start` build and run the production binary with the web app embedded. [RUNNING.md](RUNNING.md) has every command.

---

## 4. Engine core (`packages/engine`)

Correctness first, proved by perft; then speed. The engine has no runtime dependencies and no DOM or Node APIs, so the same code runs in the browser and in Node. Randomness only comes from an explicit seeded RNG.

### 4.1 Representation

- A 0x88 board in an `Int8Array(128)`; piece codes `1..6` are P N B R Q K for White, negated for Black, `0` is empty.
- `Position` holds the board, side to move, castling rights (4 bits, KQkq), en passant square, halfmove clock, fullmove number, king squares, piece counts per type and colour, and the Zobrist key as two 32-bit halves.
- A move is a 32-bit integer: from (7 bits), to (7 bits), promotion piece (3 bits) and flags (capture, double push, en passant, castle, promotion). The captured piece goes on the undo stack.
- `makeMove` / `unmakeMove` use an undo stack and update the Zobrist key incrementally.
- Hot paths avoid allocation: typed arrays, numeric moves and a shared scratch move buffer. Typed-array reads whose index is already proven in range by 0x88 arithmetic use TypeScript's non-null assertion (`board[sq]!`), which costs nothing at runtime; that lint rule is relaxed for the engine's source only.

### 4.2 FEN

- `parseFen(fen)` returns `Result<Position, FenError[]>` and checks **syntax only**: 6 fields (or 4, with default clocks), 8 ranks of 8 squares, valid piece letters, side `w|b`, castling `-` or a subset of `KQkq` in order, en passant `-` or a square on rank 3/6, non-negative clocks.
- Syntactically valid but illegal positions (two white kings, a pawn on rank 1) parse successfully: the Lab must be able to show them, and legality is §5's job.
- `toFen(position)` round-trips any parsed FEN in canonical form; `targetKey(position)` returns placement plus side to move.

### 4.3 Move generation

- Pseudo-legal generation, then a legality filter (make the move, test whether the own king is attacked, unmake). When the side to move isn't in check, a non-king, non-en-passant move whose piece isn't on a line with its own king can't be pinned and skips that test (about 4 million perft nodes per second in Node).
- Every special case is handled: castling (not out of, through or into check; path empty; right present), en passant including the horizontal pin, promotions to Q/R/B/N, double pushes, pins.
- Castling flags and the en passant square are never trusted on their own. Castling also requires king and rook on their home squares, so positions with no king, two kings or stale rights never crash move generation.
- `isSquareAttacked` and `checkers` are exported for the analyzer.

### 4.4 Notation

- UCI: `moveToUci`, `uciToMove(position, uci)` (an error for illegal or malformed moves).
- SAN: `moveToSan` with correct disambiguation and `+`/`#`; `sanToMove` is lenient (missing check marks, `0-0`, lowercase promotion) but rejects an `x` on a move that captures nothing.
- `replay(ucis)` from the initial position returns the final position or `{ illegalAt, reason }`.

### 4.5 Zobrist hashing

Keys come from a fixed-seed PRNG, so hashes are identical on every machine and every run. Two 32-bit halves; no BigInt.

The hash covers placement, side to move, castling rights and the en passant file, but the en passant file only **when a pawn of the side to move could capture en passant** (pseudo-legally, ignoring pins), as Stockfish does. Positions that differ only by an unusable en passant square hash the same, so the solver's transposition table (§6.4) merges them. `toFen` still writes the en passant square after every double push, the standard FEN convention; anything comparing positions for identity uses the hash or the target key, not FEN strings.

### 4.6 Public API (excerpt)

```ts
export type Color = 'w' | 'b';
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function initialPosition(): Position;
export function parseFen(fen: string): Result<Position, FenError[]>;
export function toFen(p: Position): string;
export function targetKey(p: Position): string;
export function legalMoves(p: Position): Move[];
export function makeMove(p: Position, m: Move): void;
export function unmakeMove(p: Position): void;
export function moveToUci(m: Move): string;
export function uciToMove(p: Position, uci: string): Result<Move, string>;
export function moveToSan(p: Position, m: Move): string;
export function sanToMove(p: Position, san: string): Result<Move, string>;
export function replay(ucis: readonly string[]): Result<Position, { illegalAt: number; reason: string }>;
export function perft(p: Position, depth: number): number;
export function createRng(seed: number): Rng;
// plus analyzePosition, retractions, lastMoves (§5), solveProofGame, shortestProofGame (§6), dailyFeedback (§8.3)
```

### 4.7 Tests

Perft node counts, checked against chessprogramming.org's "Perft Results":

| Position | FEN | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|---|
| Start | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | 20 | 400 | 8902 | 197281 | 4865609 |
| Kiwipete | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1` | 48 | 2039 | 97862 | 4085603 | 193690690 |
| Pos 3 | `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` | 14 | 191 | 2812 | 43238 | 674624 |
| Pos 4 | `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` | 6 | 264 | 9467 | 422333 | 15833292 |
| Pos 5 | `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` | 44 | 1486 | 62379 | 2103487 | 89941194 |
| Pos 6 | `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` | 46 | 2079 | 89890 | 3894594 | 164075551 |

- The fast suite runs each position to the deepest depth with at most about 500,000 nodes; the nightly slow suite runs depth 5 for all and the start position at depth 6 (119,060,324).
- Property tests: FEN round-trip; make + unmake restores board and key exactly; the incremental Zobrist key equals one computed from scratch; for every legal move in random positions, SAN and UCI round-trip. Random play favours en passant, castling and promotions, and the tests assert each one actually occurs.

---

## 5. Retro analysis (`packages/engine/src/retro`)

### 5.1 Verdict model

```ts
type Severity = 'illegal' | 'deduction';
interface Finding {
  rule: RuleId;
  severity: Severity;
  message: string;          // plain English, shown in the Lab
  squares: string[];        // squares to highlight
  arrows?: [string, string][];
}
type Verdict =
  | { kind: 'illegal'; findings: Finding[] }                 // at least one 'illegal' finding
  | { kind: 'legal'; proof: string[]; findings: Finding[] }  // UCI proof game found (§6)
  | { kind: 'undecided'; findings: Finding[]; reason: 'no-contradiction-found' | 'search-limit' };

export function analyzePosition(p: Position, opts?: AnalyzeOptions): AnalysisReport;
```

**Soundness:** `illegal` only when the contradiction is certain, and never `legal` without a proof game. `deduction` findings are true facts about the position's history; they become the Lab's detective notes.

**Deciding `legal`.** When no illegal finding exists, `analyzePosition` makes a quick proof attempt: `shortestProofGame` (§6) from the lower bound upward, honouring the FEN's claims (every stated castling right must survive to the end, and a stated en passant square must be the final one). Defaults: 10 plies, 750 ms, 1,000,000 nodes. A proof found is replayed as a self-check, and the verdict is `legal` with that shortest proof. Otherwise the verdict stays `undecided`: `search-limit` if the proof attempt or the last-move search was cut short, else `no-contradiction-found`. Failing to find a proof never makes a position illegal.

### 5.2 Static rules

Each rule has a test that triggers it and a test that it stays silent on legal positions.

| RuleId | Severity | Check | Example message |
|---|---|---|---|
| `KING_COUNT` | illegal | Exactly one king per side | "White has 2 kings. Each side has exactly one king." |
| `PAWN_ON_BACK_RANK` | illegal | No pawn on rank 1 or 8 | "The white pawn on h1 is impossible: pawns never stand on the first or last rank." |
| `TOO_MANY_PIECES` | illegal | At most 16 pieces per side | "Black has 17 pieces but started with 16." |
| `TOO_MANY_PAWNS` | illegal | At most 8 pawns per side | |
| `PROMOTION_EXCESS` | illegal | `pawns + minPromotions ≤ 8`, where `minPromotions = max(0,Q−1) + max(0,R−2) + max(0,N−2) + max(0,lightB−1) + max(0,darkB−1)` | "White has 3 queens, so at least 2 were promoted. With 7 pawns still on the board that's 9 pawns, but White only had 8." |
| `OPPONENT_IN_CHECK` | illegal | The side *not* to move is not in check | "It's White to move, but the black king on e8 is in check from the rook on e7." |
| `TOO_MANY_CHECKERS` | illegal | At most 2 checkers | "The black king is in check from 3 pieces at once; one move can create at most a double check." |
| `PAWN_STRUCTURE_IMPOSSIBLE` | illegal | A side's pawns can be assigned to distinct starting files (§5.2.1) | "The white pawn on a3 has no possible starting file…" |
| `PAWN_CAPTURES_EXCEED_MISSING` | illegal | Captures needed by a side's pawns ≤ the opponent's missing pieces (§5.2.1) | "White's pawns needed at least 1 capture to get where they are, but all 16 black pieces are still on the board." |
| `CASTLING_RIGHTS_INCONSISTENT` | illegal | Every claimed castling right has king and rook on their home squares | "The FEN says White can castle kingside, but the white king is on f1." |
| `EN_PASSANT_INCONSISTENT` | illegal | An en passant square means the matching pawn just double-pushed | |
| `NO_POSSIBLE_LAST_MOVE` | illegal | Not the initial position, and no viable retraction at depth 1 (§5.4) | "There's no move Black could have just played to reach this position." |
| `NO_POSSIBLE_HISTORY` | illegal | Viable retractions at depth 1, but every one definitely not viable at the analysed depth k > 1 (§5.4) | "Every move White could have just played leads back to a position with no possible last move (checked 3 moves deep)." |
| `PROMOTED_PIECE_REQUIRED` | deduction | The `PROMOTION_EXCESS` formula is above 0 | "At least one white bishop is a promoted pawn: White has two dark-squared bishops." |
| `CAPTURES_REQUIRED` | deduction | Captures needed by a side's pawns above 0 | "White's pawns made at least 2 captures." |
| `CASTLING_LOST` | deduction | King or rook not on its home square | "White can no longer castle kingside: the h1 rook has moved." |
| `LAST_MOVE_FORCED` | deduction | Exactly one distinct last move (UCI) among the viable retractions; retractions differing only in the piece un-captured count as one | "Black's last move must have been …Kxg8, capturing a knight or a bishop." |

#### 5.2.1 Pawn capture accounting

Every pawn starts on its own file, and every file change takes a capture. For one colour:
- Assigning a pawn on file f to starting file s costs `|f − s|` captures, or infinity if the pawn couldn't reach its rank from its start rank with that many file changes (file distance ≤ rank distance travelled).
- The cheapest assignment of pawns to distinct starting files is the minimum number of captures by those pawns. With at most 8 pawns and 8 files, a dynamic program over bitmasks of used files computes it exactly (at most 2⁸ states × 8 files); it gives the same result as the Hungarian algorithm with simpler code. A pawn already on a target square is matched first, which is exact because pawn distance obeys the triangle inequality.
- If no finite assignment exists, the position is illegal (`PAWN_STRUCTURE_IMPOSSIBLE`). A maximum matching leaves some pawn X unmatched, and the alternating paths from X give a group S of pawns with only |S| − 1 possible files (a violation of Hall's condition). The message names X and highlights the group, e.g. white pawns on a2, b2, a3, b3.
- If the minimum exceeds the opponent's missing pieces (16 − their piece count), the position is illegal (`PAWN_CAPTURES_EXCEED_MISSING`).

This ignores promoted pawns and captures by pieces, which only relaxes the bound, so it stays valid.

### 5.3 Retraction generator

`retractions(p)` returns every retraction: the prior position, the forward move (UCI) and its kind, `normal | uncapture | unpromotion | unpromotion-uncapture | un-en-passant | uncastle`.

The retractor is the side not to move. For each of its pieces:
- **Normal un-move.** Back along the piece's movement pattern to an empty square; sliders retract through empty squares only. Pawns retract one square, or two from their 4th rank with the square between empty, never onto their own first rank.
- **Un-capture.** The same geometry (pawns diagonally backwards), then an opponent P, N, B, R or Q appears on the vacated square, if the opponent's material still passes `TOO_MANY_PIECES`, `TOO_MANY_PAWNS` and `PROMOTION_EXCESS`.
- **Un-promotion.** A Q/R/B/N on the retractor's last rank becomes a pawn one rank back, on the same file or (with an un-capture) an adjacent one.
- **Un-en-passant.** A pawn on its 6th rank retracts diagonally to its 5th; an opponent pawn reappears beside it, the square two ahead of that pawn must be empty, and the prior position gets the en passant square.
- **Un-castling.** King on g1 with rook on f1 and e1/h1 empty (queenside: king c1, rook d1, a1/b1/e1 empty), mirrored for Black. The prior position regains the right; the king must not have been in check there, nor on the square it crossed.

Each candidate prior position P′ is checked:
1. In P′ it's the retractor's turn, so the opponent's king must not be in check.
2. If P states an en passant square, only the matching double push is valid.
3. **Forward confirmation.** The moved piece's legal moves in P′ (plus castling for a king) must include one that produces P: same placement and side to move, the same en passant square **only when P states one**, and **every castling right P states** must survive the move. Stated castling rights and a stated en passant square are claims about the history; `-` claims nothing. Many FENs write `-` right after a double push, so `-` means "not stated", and after 1.e4 e5 written with `-`, …e7-e5 is still a possible last move. This makes retractions sound by construction.

What a prior position can't know is filled in conservatively: a normal retraction copies P's castling rights (an un-castling adds the one it used); P′ has no en passant square unless the retraction is an un-en-passant; its halfmove clock is 0 and its move number one lower when Black is the retractor (never below 1). Extra rights P′ might have had don't change any verdict.

Performance: candidates are tried on one scratch position (at most four square changes, check, revert), and prior positions are built lazily.

### 5.4 Last-move analysis

`lastMoves(p, { depth, timeLimitMs, nodeLimit, shouldStop })`:
- A retraction to P′ is **viable at depth k** if P′ passes every static rule except `NO_POSSIBLE_LAST_MOVE` (which is defined by viability), and k = 1, or P′ is the initial position, or P′ has a retraction viable at depth k − 1.
- Each depth-1 retraction is reported with its viability at the requested depth, in words ("White's last move could have been Bf1xb5, capturing a black knight"). Viability is **viable**, **not viable** or **unknown** (a limit cut the search short). Depth 1 needs only the static rules, so it is always decided.
- Claims are made only from definite results: no viable retraction at depth 1 gives `NO_POSSIBLE_LAST_MOVE`; viable ones at depth 1 that are all definitely not viable at depth k gives `NO_POSSIBLE_HISTORY`; exactly one distinct viable move, with every other retraction definitely not viable, gives `LAST_MOVE_FORCED`. When a forced capture could be en passant or an ordinary capture, the message says "(possibly en passant)" and never claims en passant unless it's the only possibility.
- Results are cached by an exact key (placement, side, castling, en passant), never by hash alone, so a collision can't produce a false claim.
- `analyzePosition` defaults to depth 3, 2,000 ms and 200,000 nodes. Clocks, repetition and the 50/75-move rules are ignored.

### 5.5 Tests

- **Completeness (property):** for random positions P, every legal move m from P to Q has a retraction of Q that gives back P.
- **Soundness (property):** every retraction of Q to P′ is confirmed by the full legal move generator in P′, independently of the generator's own forward check.
- Both run over a few hundred positions in the fast suite and 50,000 in the nightly slow suite, from fixed seed ranges; every failure message starts with its seed.
- **Curated fixtures** (`packages/engine/test/fixtures/positions.json`): over 30 positions, each with its expected verdict, rule ids and a one-line explanation, for example:

| FEN | Expected |
|---|---|
| `k7/8/8/8/8/8/8/K6P w - - 0 1` | illegal: `PAWN_ON_BACK_RANK` |
| `4k3/4R3/8/8/8/8/8/4K3 w - - 0 1` | illegal: `OPPONENT_IN_CHECK` |
| `4k3/8/3N4/1B6/8/8/8/4R2K b - - 0 1` | illegal: `TOO_MANY_CHECKERS` |
| `4k3/8/8/8/8/8/PPPPPPPP/QQ2K3 w - - 0 1` | illegal: `PROMOTION_EXCESS` |
| `rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1` | illegal: `PAWN_CAPTURES_EXCEED_MISSING` |
| `4k3/8/8/8/8/8/8/5K1R w K - 0 1` | illegal: `CASTLING_RIGHTS_INCONSISTENT` |
| `4k3/8/8/8/8/8/8/4K3 w - e6 0 1` | illegal: `EN_PASSANT_INCONSISTENT` |
| `rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2` | legal, proof `e2e4 e7e5`, with …e7-e5 still a possible last move |
| `8/8/8/8/8/8/8/K6k w - - 0 1` | undecided (needs a long proof game) |
| `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1` | undecided. Actually illegal by parity: with every pawn home only knights (and a rook into a vacated knight square) can move, and every trip back home takes an even number of moves. Proving that is an idea for later (§12). |

---

## 6. Proof-game solver (`packages/engine/src/solver`)

### 6.1 Problem

Given a target key T and a ply count N, find (or count) the move sequences of exactly N plies from the initial position that end in T.

```ts
interface SolveOptions {
  plies: number;
  mode: 'find-one' | 'find-all' | 'count';
  cap?: number;                  // stop once this many are found
  timeLimitMs?: number;
  nodeLimit?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: { nodes: number; elapsedMs: number; plies: number }) => void;
  castling?: string;             // rights that must still hold at the end (Lab proofs)
  enPassant?: string;            // en passant square the final position must have (Lab proofs)
  ttBits?: number;               // transposition table size, 2^ttBits entries
}
interface SolveResult {
  status: 'complete' | 'limit' | 'aborted';
  solutions: string[][];         // UCI sequences (find modes)
  count: number;                 // exact if status === 'complete' and count < cap
  nodes: number;
  elapsedMs: number;
}
interface ShortestResult {
  status: 'complete' | 'limit' | 'aborted';
  plies: number | null;
  solution: string[] | null;     // complete + solution: proven shortest; complete + null: none up to maxPlies
  nodes: number;
  elapsedMs: number;
  searched: number[];            // lengths searched completely without a solution
}
export function solveProofGame(target: string, opts: SolveOptions): SolveResult;
export function shortestProofGame(target: string, maxPlies: number, opts?: Omit<SolveOptions, 'plies' | 'mode' | 'cap'>): ShortestResult;
export function minimumPlies(target: string): number;
```

`count` is exact when the status is `complete` and the count is below `cap`; otherwise it's a lower bound. Daily puzzles compare the target key only; `castling` and `enPassant` serve the Lab's claims. Repetition and the 50-move rule are ignored.

`shortestProofGame` tries the smallest N with the right parity (the target's side to move fixes it) at or above the lower bound from the start position, then N + 2, and so on up to `maxPlies`, sharing one transposition table across the lengths.

### 6.2 Per-side move budgets

After k plies, r = N − k remain. With White to move, White has `ceil(r/2)` moves left and Black `floor(r/2)`; with Black to move, the reverse. A node is pruned whenever **either** side's lower bound exceeds its own budget, which is much stronger than one combined bound.

### 6.3 Lower bound h(P, T), per side

For side S, h_S is the larger of:
1. **Displacement cost.** Per piece type (light- and dark-squared bishops are separate types, since a bishop never changes square colour), a minimum-cost matching between S's current and target pieces, with empty-board distances that never overestimate:
   - King: Chebyshev distance. Knight: a precomputed BFS table.
   - Bishop: 0 on the square, 1 on the same diagonal, 2 on the same colour, else impossible. Rook and queen: 0, 1 or 2.
   - Pawn, with `dr` ranks to advance and `df` files to change: impossible if `dr < 0` or `|df| > dr`; otherwise `dr − 1` if the pawn is on its start rank and `dr − |df| ≥ 2` (a double push fits), else `dr`. A tempting shortcut that only allows the double push when `df == 0` overestimates: e2→f5 via e4 and exf5 is 2 moves, not 3.
   - Target pawns on their start rank never moved and can't have been captured ("frozen"), so distances route around them; this can prove a bishop shut in behind them unreachable.
   - Extra current pieces (still to be captured) cost S nothing.
   - **Promotions.** With E = (current pawns of S) − (target pawns of S), any non-pawn target piece may be explained as a promoted pawn at cost 0, at most E times *per type*. A forced match would overestimate: a white knight far from the target knight's square, with a white pawn on the 7th rank one move from promoting there (the old knight captured later, at no cost to White), really costs 1, but a forced knight match says 4. Allowing E per type relaxes the real limit (E in total), so the bound stays admissible.
2. **Captures S must make:** (opponent pieces now) − (opponent pieces in the target), each a separate move of S.

Impossible targets are cut at once: more target pieces than current ones; target pawns that can't be matched to current pawns; more unmatched target pieces than pawns left to promote.

**The castling trap.** Castling moves king and rook in one move, so naive distances overestimate and silently break the search. While S still has a castling right, the king's cost is min(normal distance, 1 + distance from its castled square), and a rook on its home corner costs min(normal distance, distance from its castled square), the rook's part counted as free. The castling move counts once, through the king.

**Admissibility property test.** For seeded random games of N plies with target T, every prefix position satisfies h_White ≤ White's remaining moves and h_Black ≤ Black's. The games include castling, promotions, en passant and promotions to a type the side already had with the original piece captured later (the pattern that breaks a forced matching); the test asserts each occurs. A dedicated test pins down the knight counterexample above.

**Incremental bound.** The search pushes and pops moves on `createIncrementalBound`, which updates only the one to three piece lists a move touches and memoizes per-kind costs on a version number. The pawn part is cached by pawn configuration, and the general assignment only runs with three or more pieces of one kind. With one ply left, only a move between two of the (at most four) squares that differ from the target can finish, so the bound isn't evaluated. A property test compares the incremental bound with one computed from scratch.

### 6.4 Search

- Depth-first search with the exact remaining ply count, pruned by §6.2 and §6.3; at r = 0 the target keys are compared.
- In find modes, moves are ordered by decreasing bound improvement.
- **Memoized counting.** A transposition table keyed by (Zobrist key, remaining plies) stores the number of solutions from a node, saturated at `cap`. Repeated subtrees become a lookup, which makes uniqueness checks (`cap = 2`) cheap. Positions differing only by an unusable en passant square share an entry (§4.5), which is correct because their futures are identical. The table is fixed-size and typed-array-based, stores the full key to rule out collisions, and records dead ends (count 0) in find modes. A subtree cut short by a limit is never stored.
- Tables are pooled per size and cleared in O(1) with a generation counter, so thousands of small solves don't each allocate megabytes. The default size grows with the search, up to 2²⁰ entries (about 13 MB) from 8 plies.
- Limits (`shouldStop`, time, nodes) are checked on the first node and every 256 nodes after, because a find-mode node evaluates the bound for every child; progress is reported about every 50,000 nodes and when each length starts.

### 6.5 Tests

- The admissibility property test (§6.3).
- **Brute-force cross-check.** Every game of exactly N plies from the start is enumerated and grouped by target key. For N ≤ 4 (197,281 games at N = 4) the counts are compared with `solveProofGame` in count mode for a sample of targets; N = 5 runs in the slow suite.
- **External check.** The brute-force statistics for N ≤ 5 match wismuth.com's diagram statistics. There a "diagram" is the 64 squares only, but with exactly N plies from the start the side to move is fixed by parity, so per N it equals our target key.
- Every random N-ply game's target is solvable at N plies.
- `pnpm --filter @retrograde/engine bench` solves targets from random games at 6, 8 and 10 plies and prints median and p95 time and nodes.

---

## 7. Puzzle generator (`apps/generator`)

### 7.1 CLI

```
generator generate --count 500 --seed 42 --min-plies 5 --max-plies 12 --jobs 4 --out puzzles.jsonl [--source beam|random|both] [--node-limit N] [--width W] [--children C] [--random R]
generator verify puzzles.jsonl
generator stats puzzles.jsonl
```

Defaults: `--node-limit 200000`, `--width 180`, `--children 8`, `--random` 4 × count, `--jobs 1`. `generate` also writes `<out>.stats.json` (per-ply acceptance and timings), separately, so the JSONL stays byte-identical across runs. `verify` replays every solution, reruns the solver checks and recomputes features, score and stars.

`--jobs` uses `worker_threads`. Each candidate gets a seed derived from `--seed`, output is sorted by candidate index, and searches are bounded by **node limits, never time limits**, so a verdict doesn't depend on machine speed and the output is byte-identical for a seed and engine version whatever `--jobs` is.

### 7.2 Pipeline per candidate

**Candidate sources.** Random games are almost never unique beyond about 8 plies, because independent moves can be played in another order. The main source is therefore a **beam search** that grows puzzles one ply at a time from accepted ones. If a game of N + 1 plies is the unique shortest proof game for its target, its first N plies are the unique shortest proof game for that position's full state; for the target key alone this can fail only when the last move is castling or en passant. So every candidate is an accepted puzzle plus one legal move.

- Per parent, extensions whose last move could have been played at an earlier turn of the same side are dropped first. That's a free, sound non-uniqueness test (about 0.1 ms) that rejects most candidates before any search.
- The 8 most interesting remaining extensions are verified (more while the frontier is small, about W × 8 per ply).
- The frontier (W = 180) is kept diverse: at most max(3, W / parents) children per parent; at most W/6, W/12, W/15 and 2 puzzles sharing their first 1, 2, 4 and 6 plies; a preference for captures, promotions, castling, en passant, switchbacks and checks; no lines where a side's last three moves are quiet king moves. Without the prefix caps, every long puzzle descended from a handful of openings.
- Random games with biased move weights (captures ×3, promotions ×5, underpromotions ×8, castling ×3, en passant ×6, returning to a visited square ×2) remain a second source, for puzzles that end in castling or en passant.

Each candidate is then verified:
1. Target = `targetKey` of the final position.
2. **Unique:** count at N with `cap = 2` must be exactly 1 with status `complete`. This runs first because it fails most often and stops at the second solution.
3. **Shortest:** counts at N − 2, N − 4, … down to the lower bound must all be 0 with status `complete`.
4. Features and difficulty (§7.3).

Candidates that hit a limit are discarded, never emitted, so the long puzzles lean towards ones the solver can prove quickly. The final pool is chosen with per-ply quotas (about 15% at 5–6 plies, 28% at 7–8, 15% at 9, 28% at 10–11, 14% at 12) and at most 3 puzzles per 6-ply prefix, highest scores first, filling the longest quotas first because long puzzles are scarce. The committed pool, `data/puzzles-v1.jsonl` (500 puzzles, seed 1), takes about 72 minutes on a 2-core laptop with `--jobs 4`.

### 7.3 Features and difficulty

Features are detected from the solution, following each piece by identity: `capture`, `promotion`, `underpromotion`, `castling`, `en-passant`, `switchback` (a piece returns to a square it left, by another way), `tempo` (straight back: A→B→A), `king-walk` (one side's king moves at least twice, castling not counted) and `phoenix` (a side promotes to a type of which an original piece of that side is captured in the game).

```
score = plies + 1.5·captures + 3·promotions + 4·underpromotions + 2·castling + 3·enPassant
        + 2·switchbacks + 2·tempo + log2(solverNodes) / 4        (rounded to 2 decimals)
```

`solverNodes` is the node count of the uniqueness check: how much work it takes to see that there is exactly one game.

Stars come from quantiles of the pool, with cut points matching the weekly ramp (§8.7): the lowest 1/7 of scores is ★, up to 3/7 ★★, up to 5/7 ★★★, up to 6/7 ★★★★, the top 1/7 ★★★★★. So the pool's level mix matches how often each level is scheduled.

### 7.4 Output (one JSON object per line)

```json
{"id":"g42-000137","plies":2,"target":"rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w","solution":["g1f3","g8f6"],"features":[],"difficulty":1,"score":2.0,"solverNodes":41,"engineVersion":"0.4.0","seed":42}
```

(A deliberately tiny example: 1.Nf3 Nf6 is the only 2-ply game reaching that position. Real puzzles have 5–12 plies.) Ids are `g{seed}-{index}` with a 6-digit index; random-source candidates are indexed from 1,000,000. Lines are sorted by index. Output depends on the engine version, so `verify` compares `solverNodes` only for puzzles made by the same version.

### 7.5 Content policy

Only generated puzzles; no composed problems copied from books, magazines or databases.

---

## 8. Daily Proof Game

### 8.1 Rules

- Today's puzzle shows the target position, its difficulty and its length ("Reach this position in 4.5 moves · 9 plies").
- A guess is a complete legal game from the initial position of exactly N plies.
- Six guesses. A guess whose final target key equals the target solves the puzzle. Puzzles are unique, so that means the player found the solution, but any game reaching the target is accepted.
- After six wrong guesses the attempt fails and the solution is revealed.

### 8.2 Input

- Moves are played on the board from the initial position; the board allows only legal moves, and promotions open a picker. Typing SAN or UCI is the keyboard alternative.
- Visible: the move list in SAN, a ply counter (`5 / 9`), Undo, Reset and a small target board. A "difference overlay" highlights squares where the board differs from the target; it's computed in the browser from the public target, so it leaks nothing.
- Submit is enabled only at exactly N plies, once the attempt has started, and not for a game already tried.
- Earlier guesses appear as rows of feedback cells; tapping a row loads that guess onto the board for editing.

### 8.3 Feedback (computed by the server)

Per ply i, the guess move gᵢ is compared with the solution move sᵢ (UCI strings):
1. **Green (`G`, 🟩, ✓):** gᵢ == sᵢ. Solution ply i is used.
2. **Yellow (`Y`, 🟨, ↔):** otherwise, if gᵢ equals an unused solution move sⱼ (j ≠ i) **at a ply of the same colour** (j ≡ i mod 2). Plies are processed left to right and the leftmost such j is used.
3. **Gray (`X`, ⬛, ✕):** otherwise.

Greens are assigned in a first pass before any yellows, as in Wordle. Colours always come with their icon and words, never alone.

| Solution | Guess | Feedback |
|---|---|---|
| `e2e4 e7e5 g1f3 g8f6 f3g1 f6g8` | `g1f3 e7e5 e2e4 g8f6 f3g1 b8c6` | `YGYGGX` |
| `g1f3 g8f6 f3g1 f6g8 g1f3 b8c6` | `g1f3 b8c6 f3g1 c6b8 g1f3 g8f6` | `GYGXGY` |
| `g1f3 g8f6 f3g1 f6g8 g1f3 b8c6` | `g1f3 g8f6 f3g1 f6g8 g1f3 g8f6` | `GGGGGX` |

These and 11 more are in `fixtures/feedback-vectors.json`, generated from the engine's reference implementation (`dailyFeedback`) and checked by the Go tests.

**How to play** uses 1.e4 e5 2.Ke2 Ke7 as its example, with the guess 1.Nf3 e5 2.e4 Ke7 (✕ ✓ ↔ ✓). A test checks with the solver that the example is a unique shortest proof game (so "right but swapped" can't also solve it), and its feedback with `dailyFeedback`.

### 8.4 Hints (each is recorded and costs ranking)

1. **Movers:** which piece types moved at least once, per colour ("White: knight, pawn · Black: knight").
2. **Captures:** the plies where captures happen, or "no captures".
3. **One move:** the solution move at the first ply that isn't green in the player's latest guess, or ply 1 before any guess. The ply is stored when the hint is taken, so it doesn't change with later guesses.

Hints are served by the server, in order, one per request. Every ply in the API is 1-based.

### 8.5 Results, ranking and stats

- Daily leaderboard order: solved first, then fewer guesses, then fewer hints, then shorter solve time (`finished_at − started_at`, where `started_at` is when the player started the puzzle). Times over an hour show as h:mm:ss.
- **Streaks** count consecutive UTC days with a solved daily. A solve counts for the puzzle's own day, even if it finishes after midnight. A failed daily ends the current streak at once, as in Wordle, and so does a skipped day: the stored streak is shown only while the last solve was today or yesterday. The maximum streak is kept.
- **Profile stats:** played, solved, win rate, current and maximum streak, guess distribution (1–6 and failed, drawn as a bar chart with the same numbers as a table for screen readers) and average hints.
- **Archive attempts count in no statistics,** not only in streaks and leaderboards, so the stats describe daily play and can't be padded by replaying the archive.

### 8.6 Share card

```
Retrograde #142 ★★★ · 4.5 moves
3/6 · 🔍1
🟨🟩⬛🟩⬛⬛🟩🟩🟨
🟩🟩🟨🟩🟩⬛🟩🟩🟩
🟩🟩🟩🟩🟩🟩🟩🟩🟩
https://<BASE_URL>/daily
```

A failed attempt shows `X/6`; with no hints the `🔍n` part is left out. The card contains feedback only, never moves. An archive (practice) card says `Retrograde #142 (practice)` and links to `/daily/142`. After finishing, a countdown shows when the next puzzle is out (the UTC midnight after the finished puzzle's day), in the player's local time.

### 8.7 Scheduling and archive

- Weekly difficulty ramp: Mon ★, Tue ★★, Wed ★★, Thu ★★★, Fri ★★★, Sat ★★★★, Sun ★★★★★.
- `retrograde schedule --from YYYY-MM-DD --days 365` assigns unscheduled puzzles deterministically by weekday level (the lowest unscheduled puzzle id of that level; days already scheduled are kept), refuses days before `LAUNCH_DATE`, fails loudly if a level runs out, and always prints how many unscheduled puzzles of each level remain.
- A year needs about 53 each of ★, ★★★★ and ★★★★★ and about 105 each of ★★ and ★★★, which is why the pool has 500 puzzles with ramp-shaped cut points (§7.3).
- Earlier puzzles are playable in the archive: the same UI, with attempts flagged `archive` when they start. The solution is still revealed only after finishing.

### 8.8 Guests

Reading a puzzle (`GET`) creates nothing. Starting one (`POST /daily/{number}/start`) without a session creates a guest player and an anonymous session cookie. Guests play the daily and appear on no leaderboard. Guest players older than 30 days with no guesses are deleted by the cleanup job (§10.3). When a guest registers or signs in, their attempts move to the account for every puzzle the account hasn't played (§10.6).

---

## 9. Lab

### 9.1 Layout

A board editor (drag pieces from a palette onto the board and off it), a FEN input with inline syntax errors (missing trailing fields default to `w - -`), side to move, castling and en passant fields, and "Start position" and "Clear" buttons. Keyboard editing: a palette piece arms 64 square buttons over the board, which a click, a tap or Tab + Enter places on; Escape disarms. On a phone the report sits below the board, on wide screens beside it.

### 9.2 Report

- **Verdict banner:** Illegal / Legal (proved) / Undecided, with a one-sentence reason.
- **Detective notes:** every finding in plain English, findings of one rule grouped into one note. Hovering or focusing a note highlights its squares and arrows on the board.
- **Possible last moves:** depth-1 retractions with their viability at depth 3 (adjustable 1–6), each with "Take it back", which loads the prior position.
- **Prove it:** `shortestProofGame` up to 16 plies with progress and Cancel. A proof found plays back step by step with a scrubber. Screen readers hear the length being searched and the outcome, not every node count.

Analysis runs automatically 300 ms after the last edit; Prove runs only on request. While a new analysis runs, the previous report stays visible but dimmed and inert, so nothing in it can act on the wrong position.

### 9.3 Permalinks and examples

The URL holds the position (`/lab?fen=…`), so any analysis can be shared. Edits replace the history entry; take-backs and examples push one, so Back undoes them. "Copy link" copies the URL, and "Open in Lichess" opens the position in Lichess's board editor (`https://lichess.org/editor/<FEN with spaces as underscores>`). An example gallery shows fixture positions with teaser titles ("Who moved last?", "Count the captures", "The impossible start").

### 9.4 Worker protocol

The engine runs in Web Workers exposed with Comlink: `analyze(fen)`, `lastMoves(fen, depth)`, `prove(target, maxPlies)` with progress through a proxied callback. Analysis and proving use separate workers, so analysis keeps working during a proof. A synchronous search can't receive a cancel message, so Cancel terminates the worker and creates a fresh one; the UI shows "Cancelled", progress messages still queued are ignored, and a worker that fails to load or crashes rejects its pending calls instead of hanging.

---

## 10. Backend: API and data model (`services/api`)

### 10.1 Layout

- `cmd/retrograde`: one binary with the subcommands `serve`, `migrate`, `import-puzzles <file.jsonl>` (idempotent), `schedule --from --days` and `cleanup`. `cmd/server` runs the server alone, with settings from the environment: it's the entry point Vercel's Go runtime builds. Both call `internal/server`, which starts in this order:
  1. **Unsafe production settings stop it** (§10.2), before it touches the database or a port.
  2. **Pending migrations stop it**, naming the fix (`pnpm db:migrate`, or `retrograde migrate`): otherwise the first query touching the missing schema would fail much later. The check is read-only. If the database can't be reached, the server logs an error and starts anyway, so `/api/health` reports the outage.
  3. It warns when `RATE_LIMIT_SCALE` isn't 1 and when fewer than 30 days of puzzles remain scheduled.
  4. Where the process lives on between requests (a container, local development), it runs the cleanup job (§10.3) at startup and every hour. On Vercel, instances pause between requests, so a daily cron calls the cleanup endpoint instead.
- `internal/config`: settings from the environment and `.env`, validated at startup.
- `internal/httpapi`: the generated strict-server interface, middleware (request id, logging, recover, security headers, rate limits, CSRF/origin check, contract validation), and `application/problem+json` errors whose `detail` is a full sentence for the UI.
- `internal/auth`: passwords, sessions, guests and the guest merge, Sign in with Lichess. `internal/lichess`: the Lichess OAuth client.
- `internal/daily`: the puzzle of the day, attempts, guesses, feedback, hints, streaks; pure functions wherever possible, tested without HTTP or a database.
- `internal/leaderboard`, `internal/chessrules` (the adapter around the Go chess library), `internal/ratelimit`, `internal/store` (sqlc queries and a transaction helper), `internal/clock` (injected, so day boundaries are testable with a fake clock).
- `internal/webui`: in builds with the `webui` tag (the container image and `pnpm build`), the web app is embedded (`go:embed`) and served next to the API: hashed `/assets/*` cached for a year, everything else revalidated, client routes falling back to `index.html`, and a missing file with an extension a 404 rather than HTML. `go:embed` can't read outside the Go module, so the build copies `apps/web/dist` into the module first. Without the tag (development, Vercel) the Vite dev server or the CDN serves the web app.

**Chess rules on the server.** `internal/chessrules` uses `github.com/corentings/chess/v2` on positions, not on the library's `Game`, so draw rules never end a game, and it enforces the engine's UCI rules (a promotion letter exactly when a pawn reaches the last rank). It agrees with every replay vector, including the SAN of every move.

### 10.2 Configuration (environment)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:<password>@localhost:5432/retrograde?sslmode=disable` | Required |
| `TEST_DATABASE_URL` | `…/retrograde_test?sslmode=disable` | Only for integration and end-to-end tests; their helpers refuse any database whose name doesn't end in `_test` |
| `HOST` | `127.0.0.1` (default), `0.0.0.0` in a container | The default keeps the development server private to the machine (no Windows firewall prompt) |
| `PORT` | `8080` | |
| `BASE_URL` | `http://localhost:5173` in development | Redirects, origin checks, share links |
| `LAUNCH_DATE` | `2026-11-01` | Puzzle #1's UTC date. `pnpm seed` sets it to 14 days ago in a local `.env` that lacks it, so there are past puzzles to play. |
| `COOKIE_SECURE` | `true` in production | |
| `LICHESS_BASE_URL` | `https://lichess.org` | Overridden by the tests' fake Lichess |
| `LICHESS_CLIENT_ID` | defaults to `BASE_URL`'s host | Lichess needs no registration, only a unique client id |
| `LOG_LEVEL` | `info` | |
| `TRUSTED_PROXIES` | `10.0.0.0/8,127.0.0.1` | `X-Forwarded-For` is honoured only when the direct peer is in this list; empty (the default) trusts no proxy |
| `RATE_LIMIT_SCALE` | `1` (default) | Multiplies every rate limit. Only the end-to-end tests raise it. |
| `APP_ENV` | `production` | Production mode, below. Automatic on Vercel. |
| `CRON_SECRET` | 32+ random characters | Authorizes `GET /api/internal/cleanup` (§10.4), which Vercel's cron calls as `Authorization: Bearer <CRON_SECRET>`. Unset: the endpoint refuses every request. |
| `CLIENT_IP_HEADER` | `X-Real-IP` on Vercel | A header the platform sets to the client's IP and clients can't forge (Vercel overwrites `X-Forwarded-For` and `X-Real-IP`). Used for rate limits instead of the connection's address. Not combined with `TRUSTED_PROXIES`. |

**On Vercel** (the platform sets `VERCEL=1`), the defaults follow the deployment: `HOST` is `0.0.0.0` and `PORT` is Vercel's. `BASE_URL`, when not set, is the project's production domain in production, and otherwise the deployment's own address, which belongs to that deployment alone (a branch alias can move to a later deployment). The deployment's other addresses are also accepted as origins by the CSRF check, so a preview works under either of its URLs; Lichess sign-in on a preview uses its deployment address.

**Production mode** (`APP_ENV=production`, or on Vercel) refuses to start with obviously unsafe settings: `COOKIE_SECURE` not true; a `BASE_URL` that isn't a public https address; `RATE_LIMIT_SCALE` other than 1; no explicit `LAUNCH_DATE`; `TRUSTED_PROXIES` that trusts every address; `LICHESS_BASE_URL` other than https://lichess.org; a `CRON_SECRET` under 32 characters. On Vercel it also requires `CRON_SECRET` and `CLIENT_IP_HEADER`, and refuses a database URL that points at the local machine or sets `sslmode=disable`. Every problem is reported at once.

### 10.3 Data model

The schema lives in `services/api/db/migrations` (goose, append-only); queries are in `services/api/db/queries` (sqlc).

| Table | Holds |
|---|---|
| `users` | `username` (citext, unique, 3–20 of `[A-Za-z0-9_-]`), `password_hash` (argon2id PHC string; null for Lichess-only users), `lichess_user_id` (unique), `lichess_username` (for the profile link, refreshed at each sign-in) |
| `players` | Every visitor is a player; guests have `user_id` null |
| `sessions` | `token_hash` (sha256 of the random token, which exists only in the cookie), player, `last_seen_at`, `expires_at` |
| `puzzles` | `external_id` (the generator id, which makes import idempotent), `plies`, `target`, `solution` (never returned before the attempt finishes), `difficulty`, `features`, `solver_nodes`, `engine_version` |
| `daily_schedule` | `day` → `number` → `puzzle_id`, each unique |
| `attempts` | One per player and puzzle: `is_archive` (fixed at creation), `status` (`in_progress`, `solved`, `failed`), `hints_used`, `hint_move_ply` (hint 3's stored ply), `started_at`, `finished_at` |
| `guesses` | Per attempt, `idx` 0–5, `moves`, `feedback` |
| `player_stats` | `played`, `solved`, `current_streak`, `max_streak`, `last_solved_day`, `guess_dist` (1–6 and failed), `hints_total` |
| `oauth_states` | `state_hash`, `code_verifier`, the guest to merge, `return_to`, `expires_at` |

Indexes serve the daily leaderboard (solved, non-archive attempts by puzzle and finish time), session expiry, guest cleanup and OAuth state expiry; an integration test checks with `EXPLAIN` that the hot and periodic queries use them. Timestamps are scanned as UTC, so the API doesn't depend on the server's time zone.

**Cleanup job**: deletes expired sessions, expired OAuth states, and guest players older than 30 days with no guesses (their attempts, sessions and stats cascade). A guest with a guess is kept. Without it, the guests that visitors and crawlers create and leave would accumulate. It runs hourly inside a long-lived server, on demand with `retrograde cleanup`, and on Vercel once a day at 03:00 UTC (Hobby crons run once a day, at some point within the hour) through `GET /api/internal/cleanup`. Each run is idempotent, because a cron delivery can be missed or repeated; it also reports how many days of puzzles remain scheduled and logs a warning below 30.

### 10.4 Endpoints

All paths are under `/api`; JSON in and out; errors are `application/problem+json`. **GETs have no side effects**: reading a puzzle creates no player, session, attempt or cookie, so crawlers create no rows. Starting a puzzle is an explicit `POST`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | 200 `{"status":"ok","db":"ok"}`, or 503 `{"status":"unavailable","db":"error"}` if the database doesn't answer within 2 seconds |
| `GET /auth/me` | session | `{ guest, username?, stats }` |
| `POST /auth/register` | session (guest ok) | Creates the user, merges the guest, rotates the session |
| `POST /auth/login` | session (guest ok) | The same merge and rotation |
| `POST /auth/logout` | session | Deletes the session |
| `GET /auth/lichess/start?return_to=` | none | 302 to Lichess (§10.6) |
| `GET /auth/lichess/callback` | none | Completes the sign-in, 302 to `return_to` or to `/login?lichess=<reason>` |
| `GET /daily` | session optional | Today's puzzle, plus the caller's attempt if started, plus the solution only when finished |
| `GET /daily/{number}` | session optional | The same for an earlier puzzle |
| `POST /daily/{number}/start` | creates a guest session if needed | Starts the attempt (`started_at`); idempotent |
| `POST /daily/{number}/guesses` | session | `{moves}` → `{feedback, status, solution?}` |
| `POST /daily/{number}/hints` | session | The next hint: `movers {white, black}`, `captures {plies}` or `move {ply, uci, san}` |
| `GET /leaderboards/daily/{number}` | none | Top entries plus the caller's rank |
| `GET /leaderboards/all-time?metric=current_streak\|max_streak\|solved` | none | Top 100 |
| `GET /users/{username}` | none | Public profile and stats, with a link to the Lichess profile for Lichess users |
| `GET /archive?page=` | none | Past puzzles, with the caller's result if any |
| `GET /internal/cleanup` | `Authorization: Bearer <CRON_SECRET>` | Runs the cleanup job (§10.3): `{sessions, guests, oauthStates, daysScheduled}`. The secret is compared in constant time by the contract validator; a missing or wrong one is a 401. |

Every request is validated against the contract (unknown fields, lengths, patterns, enums) before a handler runs. A 429 carries `Retry-After`.

### 10.5 Guess submission (one transaction)

1. A body with more than 40 moves is rejected (400) before touching the database. Future puzzle numbers are 404.
2. The attempt created by `/start` is loaded and locked (`SELECT … FOR UPDATE`); without one, 409 explains that `/start` comes first. `is_archive` was fixed when the attempt started, so an attempt started before midnight UTC and finished after it still counts for its puzzle's day.
3. A finished attempt, or one with 6 guesses, is 409.
4. The guess must have exactly the puzzle's ply count (422), each move matching `^[a-h][1-8][a-h][1-8][qrbn]?$`, and it is replayed through `chessrules`; an illegal or malformed move is 422 with its 1-based `ply`. A rejected guess doesn't use one of the six.
5. Feedback (§8.3); solved if the replayed target key equals the target.
6. The guess is inserted. If solved, or failed on guess 6, the status and `finished_at` are set and the player's stats recomputed (archive attempts count in none).
7. The response has the feedback and status, plus the solution only if the attempt just finished.

Two simultaneous guesses on one attempt are serialized by the row lock; an integration test checks it.

### 10.6 Authentication

- **Passwords:** argon2id with at least OWASP's minimum parameters (m = 19 MiB, t = 2, p = 1), stored as a PHC string. Length 8–128.
- **Sessions:** 32 random bytes, base64url, in the cookie `rg_session` (HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE`, Path=/); only the sha256 is stored. 30-day sliding expiry, written at most once an hour per session rather than on every request. The token rotates on login, register and logout.
- **CSRF:** SameSite=Lax cookies, and every state-changing request needs `Content-Type: application/json` and an `Origin` equal to `BASE_URL` (normalized as browsers write it: lower case, no default port).
- **Guest merge:** in one transaction, each guest attempt whose puzzle the account hasn't played moves to the account's player; the rest and the guest player are deleted; the account's stats are recomputed.
- **Sign in with Lichess** (OAuth 2.0 authorization code with PKCE, no client secret). Every detail was checked against Lichess's API specification, its `api-demo` example and its server code:
  1. `/auth/lichess/start` creates a random `state` and `code_verifier` (32 bytes, base64url, 43 characters, the minimum Lichess accepts) and `code_challenge = base64url(sha256(verifier))`. It stores hash(state) → verifier, the current guest and a validated relative `return_to`, for 10 minutes, and redirects to `LICHESS_BASE_URL/oauth` with `response_type=code`, `client_id`, `redirect_uri`, `code_challenge_method=S256`, `code_challenge` and `state`. No scopes: identity only.
  2. **The state is bound to the browser:** the start also sets an `rg_oauth` cookie (HttpOnly, SameSite=Lax, path `/api/auth/lichess`, 10 minutes) holding the state, and the callback requires it to match, in constant time. Checking the database alone isn't enough, because an attacker's own state is in the database too; without the cookie, an attacker could stop at their own callback link and get a victim signed into the attacker's account (login CSRF). The stored state is used once.
  3. The callback exchanges the code with a form-encoded `POST /api/token` (`grant_type`, `code`, `code_verifier`, `redirect_uri`, `client_id`), reads `id` and `username` from `GET /api/account`, and revokes the token at once (`DELETE /api/token`), even when reading the account failed. Tokens live only in memory, are never stored or logged, and Lichess's error descriptions are never echoed into logs.
  4. **Only `lichess_user_id` links accounts,** never a matching username: that would let anyone take over an account by naming their Lichess account after it. A new Lichess user whose name is taken gets `name-2` … `name-20`, then `name-` plus 6 random digits, so registering the numbered names can't lock a Lichess user out. Two simultaneous first sign-ins end in one account. The Lichess `username` must be 2–30 of `[A-Za-z0-9_-]` with `id` its lower-case form, and the profile link escapes the id.
  5. Every failure redirects to `/login?lichess=cancelled|expired|failed|busy`, which explains it. Failures on the server's side (database, Lichess errors) are logged as errors; the user's own (cancelled, expired, another browser's link) as information.
  6. Lichess shows the app by its callback address ("Allow http://localhost to access your account" in development). Users see and revoke authorized apps on `lichess.org/account/security`; with immediate revocation, Retrograde never appears there.
- **Rate limits** (in-memory token buckets, injected rather than global): login and register 60 per minute per IP and 10 per minute per username (the per-username limit is what stops password guessing; per IP is generous because many real users share an IP behind carrier NAT or a campus network); guesses and hints 30 per minute per player; `/start` 300 per hour per IP; the Lichess start 60 per minute per IP. The client IP comes from `CLIENT_IP_HEADER` on a platform that sets it, or from `X-Forwarded-For` only behind a trusted proxy (§10.2).
- **Rate limits on Vercel.** Each instance keeps its own buckets in memory, and they reset when an idle instance is paused; under heavy load, N instances allow up to N times each limit. For a small site with usually one warm instance that's acceptable: the limits slow abuse down, but they aren't a security boundary. Password guessing is also bounded by argon2id's cost and the per-username limit, and Vercel's firewall can add a platform-wide rule on `/api/auth/` (docs/DEPLOY.md). Shared limits in the database are an idea for later (§12).

### 10.7 Leaderboards

Daily: solved, non-archive attempts for the puzzle, ordered per §8.5, top N plus the caller's rank (a window function). All-time: from `player_stats` joined to users (guests excluded), with current streaks shown only while still alive (§8.5).

### 10.8 Observability

`log/slog` JSON logs with request id, method, path, status and duration. No personal data beyond usernames, and never IP addresses, passwords, session tokens, OAuth codes, states, verifiers or tokens (an integration test checks that a client's IP never reaches the logs). On Vercel the logs go to the platform's runtime logs, kept for an hour on the Hobby plan. `/api/health` pings the database with a short timeout.

---

## 11. Quality

### 11.1 Security

- Argon2id passwords, hashed session tokens, secure cookie flags, the origin check on state-changing requests, parameterized SQL only (sqlc), strict input validation from the contract, and a 16 KiB request body limit.
- Security headers on every page: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (the board's piece images are inline SVG data URIs; the theme is set before first paint by a small external script, so no `'unsafe-inline'` is needed anywhere), plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a `Permissions-Policy` that turns off camera, microphone and location, and HSTS. `vercel.json` sets them on Vercel and `internal/webui` everywhere else; a Go test keeps the two lists identical, and `vite preview` sends them too, so the end-to-end suite runs under the production CSP and fails on any violation. API responses have their own strict headers (`default-src 'none'`, `no-store`).
- Rate limits (§10.6); no secrets in logs.
- **The daily solution never leaves the server** before the player's attempt is finished: no response type carries it until then, and an integration test checks every endpoint for it.
- `return_to` and the sign-in page's `next` accept same-site paths only (no `//`, backslashes or control characters), so nothing can be used as an open redirect.
- Unsafe production settings stop the server at startup (§10.2).
- **Privacy** (`/privacy`): what is stored (username, password hash, game results, the Lichess id and name for Lichess users), the one session cookie (plus the short-lived Lichess sign-in cookie), browser storage that never leaves the browser, no analytics or third-party scripts, IP addresses never logged by the application, and the third parties: Vercel (hosting; its platform may keep request logs including IP addresses), Neon (the database) and Lichess (only for Sign in with Lichess).

### 11.2 Testing

| Package | Tests |
|---|---|
| engine | Unit, property (fast-check), perft and brute-force cross-checks; at least 90% statement coverage |
| generator | Determinism (same seed, byte-identical output whatever `--jobs` is); `verify` on a committed 20-puzzle fixture; the whole committed pool in the nightly slow suite |
| api | Unit tests for feedback, hints, streaks and day boundaries with a fake clock; integration tests against real PostgreSQL for every endpoint, including auth, the guest merge, concurrency, Sign in with Lichess against a fake Lichess server, and the no-solution-leak test. Each integration test runs in its own fresh schema, so tests are isolated and parallel. |
| cross-language | `fixtures/replay-vectors.json`: 520 random legal games (with castling, en passant, promotions and underpromotions, and each move's SAN) and 132 games with one illegal move, each with its final target key or the index of the illegal move. Generated by the engine (`pnpm --filter @retrograde/engine fixtures`) and checked by a Go test; an engine test fails if the file is stale. `fixtures/feedback-vectors.json` (§8.3). Fixtures are never edited by hand; regenerate them whenever a move rule changes. |
| web | Component and hook tests (Vitest, Testing Library); Playwright end-to-end tests against the production build, a real API on 10 fixture puzzles and a fake Lichess, with axe accessibility scans in both themes |

The fast suites run on every commit (`pnpm check`, kept under about 90 seconds); the heavy property runs use the same tests at larger sizes in nightly slow suites.

### 11.3 CI (GitHub Actions)

On every push to `main` and every pull request:
- **Ubuntu:** install with caches; lint, typecheck and fast tests for all TypeScript packages; `go vet`, golangci-lint and the Go tests (unit and integration) against a Postgres service container; a check that generated code is up to date (`pnpm gen` produces no diff); the web build; the Playwright end-to-end suite.
- **Windows:** `pnpm install`, the TypeScript fast tests and the Go unit tests, so the scripts stay Windows-compatible.
- **Container image:** builds the Dockerfile, applies migrations with the image, checks that unsafe production settings stop it, then serves and smoke-tests it (`scripts/smoke.mjs`: the page headers, client routes, `/api/health`, real database queries, and the cleanup endpoint refusing a request without the secret).
- **Deployments**, only after all of the above pass: a pull request from this repository gets a Vercel preview, and a push to `main` goes to production. Each applies migrations first (to the preview's database branch or to production), then builds and deploys with the Vercel CLI, then smoke-tests the result. Vercel's own Git deployments are switched off, so nothing deploys without passing CI.

The engine and generator slow suites run nightly. A hand-started workflow (`puzzle-data.yml`) imports the puzzle pool into a hosted database and schedules the dailies.

### 11.4 Accessibility and performance

- Everything is keyboard reachable with visible focus, controls are labelled, guess feedback is announced through `aria-live`, and colours always come with an icon or a word. Moves can be typed (SAN or UCI) instead of dragged. Every screen works at 360 px wide without horizontal scrolling.
- The main-thread JavaScript bundle stays small (about 119 KB gzipped); the engine worker loads separately (about 17 KB gzipped).
- Visual direction: a "detective's casebook". Warm paper tones in light mode, deep ink in dark mode; Fraunces for headings, Inter for the interface, IBM Plex Mono for notation, all self-hosted (OFL). The theme follows the system setting or the header's toggle. The pieces are the cburnett set shipped with chessground (GPLv2+, compatible with the repository's license).

### 11.5 Deployment

Production runs on free plans: **Vercel** (Hobby) for the site and the API, **Neon** for PostgreSQL, both in Frankfurt. `docs/DEPLOY.md` has every step.

- `vercel.json` defines two services in one project, so the site and the API share one domain (and so the session cookie, the origin check and Lichess's redirect work unchanged): `web`, the Vite build served from the CDN with the page headers and the client-route fallback, and `api`, the Go server built by Vercel's Go runtime from `cmd/server`. Requests under `/api/` go to the API, the rest to the web app. The full request path reaches the API.
- The API connects through Neon's pooled connection (PgBouncer in transaction mode), which supports the protocol-level prepared statements pgx caches. Migrations, which need a session, use the direct connection, from the deploy job, before the new version is deployed. Migrations must therefore keep the previous version working (add, don't break), since it serves traffic while they run.
- The **container image** (`Dockerfile`) is the portable alternative, for any container host or for Vercel's container runtime: the web app is built, copied into the Go module and embedded in the binary, which runs as a non-root user in a distroless image with `HOST=0.0.0.0`. `retrograde migrate` runs as a release step before `serve`. The image also carries the puzzle pool for `retrograde import-puzzles /data/puzzles-v1.jsonl`.
- The schedule is loaded once by the puzzle-data workflow: the 500-puzzle pool covers a year from any launch weekday with about 135 puzzles to spare (a test checks it).

### 11.6 Releases

Releases are version tags, `vX.Y.Z`. The 0.x releases built the product up piece by piece: foundations (0.1), engine core (0.2), retro analysis (0.3), the proof-game solver (0.4), the puzzle generator (0.5), the web shell and Lab (0.6), the API (0.7), the daily game, leaderboards, profiles and archive (0.8), and Sign in with Lichess (0.9). 1.0 is the deployed version, with the hosting, the privacy page and the documentation for running and deploying it.

---

## 12. Ideas for later

- Linking a Lichess identity to an existing password account (a "link while signed in" flow). For now a Lichess sign-in always means the account with that Lichess id.
- Self-service "delete my account" on the profile page. For now deletion is a request on GitHub.
- Rate limits shared by every instance (in the database, or the platform's firewall for every route), so serverless scaling can't multiply them.
- Stronger retro rules: parity (tempo) arguments, caged pieces (a bishop that can't have left its home square behind unmoved pawns), and capture accounting that includes promoted pawns and the colours of captured bishops.
- A story campaign of detective cases; a composer mode built on the uniqueness checker; head-to-head races; partial retrograde analysis puzzles; fairy-chess proof games.
- Puzzle ratings with Glicko-2 from solve results.
- Porting the solver to Go or Rust/WASM to compare performance.

---

## 13. References

- Retrograde analysis and proof games: the Wikipedia articles "Retrograde analysis" and "Proof game"; The Retrograde Analysis Corner (janko.at/Retros); Elkies & Stanley, *Chess and Mathematics*.
- Existing solvers, for ideas only (no code copied): Natch, Euclide, Jacobi (wismuth.com/jacobi), Popeye.
- Chess programming: chessprogramming.org (0x88, Perft Results, Zobrist hashing, move generation).
- Lichess API documentation (OAuth with PKCE, `/api/account`) and `lichess-org/api-demo`.
- chessground (github.com/lichess-org/chessground).
