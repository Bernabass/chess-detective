# Retrograde: Product and Technical Specification

Version 1.0 · 2026-10-21 · Status: approved for implementation

This document is the source of truth for v1. `CLAUDE.md` says how to work; this file says what to build. If something here is ambiguous or wrong, raise it, decide, and log the decision in `docs/DECISIONS.md`. Don't silently diverge.

## Contents

1. Product overview
2. Glossary and conventions
3. Architecture
4. Engine core
5. Retro analysis
6. Proof-game solver
7. Puzzle generator
8. Daily Proof Game
9. Lab
10. Backend: API and data model
11. Quality: security, testing, CI, accessibility, deployment
12. Phases and acceptance criteria
13. Out of scope for v1
14. References

---

## 1. Product overview

### 1.1 Pitch

Ordinary chess puzzles ask "what's the best move?". Retrograde asks "**what happened?**". Players look at a position and reason backwards like a detective: which move was played last, whether a position could ever arise, and how a game reached a given position in exactly N moves.

### 1.2 v1 scope

- **Lab.** A board editor where anyone can set up or paste a position. The engine explains whether the position is legal, lists the possible last moves, writes "detective notes" (deductions such as "at least one white bishop is a promoted pawn") and can try to prove legality by finding a game that reaches the position.
- **Daily Proof Game.** One puzzle per day for everyone. The player sees a target position and must find the game from the starting position that reaches it in exactly N plies. Six guesses, Wordle-style per-ply feedback, three optional hints, a share card, streaks.
- **Accounts and leaderboards.** Username/password and "Sign in with Lichess". Guests can play without an account, and their results move to their account when they sign up. There are daily and all-time leaderboards and public profiles.
- **Archive.** Past daily puzzles are playable in practice mode, which doesn't affect streaks or leaderboards.

### 1.3 Non-goals for v1

Story campaign ("Case Files"), puzzle composer mode, real-time multiplayer, fairy chess, partial retrograde analysis conventions, native mobile apps, translations. See §13.

### 1.4 Key user journeys

1. A guest opens `/daily`, plays a 9-ply guess on the board, gets feedback, uses one hint, solves it on guess 3 and copies the share card.
2. A chess fan pastes a strange FEN into the Lab and learns it's illegal because "White's pawns needed at least 2 captures, but no black pieces are missing".
3. A returning user signs in with Lichess, sees their 12-day streak, and checks where they rank on today's leaderboard.

---

## 2. Glossary and conventions

| Term | Meaning |
|---|---|
| **Ply** | One move by one side. All internal counts use plies. |
| **Move count notation** | Problemists write "proof game in 4.5": 4 full moves plus one White move = 9 plies. `plies = round(moves × 2)`, so 4.0 → 8 and 4.5 → 9. The UI shows both forms ("4.5 moves · 9 plies"). |
| **Proof game (PG)** | A legal game from the initial position that ends in a given position after a given number of plies, proving the position can arise. |
| **Shortest proof game (SPG)** | A proof game where no shorter proof game exists. |
| **Unique / dual** | A puzzle is *unique* if exactly one move sequence of the stated length reaches the target. Extra solutions are *duals*. Daily puzzles must be unique SPGs. |
| **Retraction (un-move)** | Taking back a move: given position P, find positions P′ and moves m such that playing m in P′ gives P. |
| **Un-capture** | A retraction that puts back a piece that was captured. |
| **Un-promotion** | A retraction that turns a piece on the last rank back into a pawn. |
| **Retractor** | The side that is *not* to move in P, i.e. the side that made the last move. |
| **Target key** | The FEN piece-placement field plus side to move, e.g. `rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w`. Daily targets are compared by target key only. |
| **Verdict** | Lab result: `illegal` (proved by a rule), `legal` (proved by a proof game), or `undecided` (nothing proved within limits). |

Conventions:
- Squares are `a1`..`h8`. Moves on the wire and in storage are UCI: `e2e4`, `e7e8q`, castling as king move `e1g1`.
- White always moves first, so after N plies the side to move is White if N is even and Black if N is odd.
- "Day" means a UTC calendar day. Puzzle #1 is the UTC date in `LAUNCH_DATE`.

---

## 3. Architecture

### 3.1 Overview

```
 Browser
 ┌──────────────────────────────────────┐
 │ React app (apps/web)                 │
 │  ├─ chessground board                │
 │  └─ Web Worker ── engine (TS)        │  Lab: analysis, retractions, solver
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

### 3.2 Key decisions

| Decision | Why |
|---|---|
| Chess and retro engine in **TypeScript** | It must run in the browser (Lab) and in Node (generator). One implementation means one source of truth for the hard algorithms. |
| Backend in **Go** + **PostgreSQL** | Accounts, sessions, leaderboards and keeping the daily solution secret need a server. Go and Postgres are strong resume skills and a good fit. |
| Server validates guesses with a **Go chess library** | The solution must stay server-side, so the server needs move legality. A mature Go library is safer than porting our engine. Cross-language fixtures (§11.2) keep the two rule implementations in agreement. |
| **Contract-first API** (`api/openapi.yaml`) | Go server stubs and TS client types are generated from one file, so they can't drift apart. |
| **Single deployable** | The Go binary embeds the built web app and serves it. One container plus Postgres. |
| Puzzles generated **offline** | Proving uniqueness is expensive. It runs ahead of time in the generator, never at request time. |

### 3.3 Repository layout

```
retrograde/
├─ CLAUDE.md
├─ .claude/rules/                 path-scoped rules (engine, api, web)
├─ api/openapi.yaml               API contract
├─ apps/
│  ├─ web/                        React + Vite + TS
│  │  ├─ src/{routes,components,features/{daily,lab,auth,leaderboard,profile},lib,worker}
│  │  └─ e2e/                     Playwright
│  └─ generator/                  Node CLI
├─ packages/engine/               TS chess + retro engine
│  ├─ src/{core,retro,solver,util}/
│  └─ test/
├─ services/api/                  Go module
│  ├─ cmd/retrograde/main.go      subcommands: serve, migrate, import-puzzles, schedule
│  ├─ internal/{config,httpapi,auth,daily,leaderboard,chessrules,store,webui,clock}
│  └─ db/{migrations,queries}/
├─ fixtures/                      cross-language test vectors (generated)
├─ scripts/                       cross-platform Node helpers for package.json scripts
├─ docs/{SPEC.md,PROGRESS.md,DECISIONS.md,learning/}
├─ .githooks/commit-msg           strips AI attribution from commit messages
├─ .gitattributes                 LF line endings everywhere
├─ package.json                   root task scripts (no Makefile)
├─ docker-compose.yml             optional Postgres for development (host port 5433)
├─ Dockerfile                     production image
└─ .github/workflows/ci.yml
```

### 3.4 Technology choices

Pin each tool to its latest stable version in Phase 0 and record the versions in `DECISIONS.md`.

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces; packages `@retrograde/engine`, `@retrograde/web`, `@retrograde/generator` |
| Task runner | Root `package.json` scripts plus Node helpers in `scripts/`; `concurrently` and `rimraf` for cross-platform behaviour. No Makefile. |
| Node | Current LTS, pinned in `.nvmrc` and `package.json#engines` |
| TS tooling | TypeScript strict, ESLint (typescript-eslint), Prettier, Vitest, fast-check |
| Web | React, Vite, React Router, TanStack Query, Tailwind CSS, chessground, Comlink (worker RPC), openapi-typescript + openapi-fetch |
| Go | Latest stable Go; `net/http` with method-pattern routing; oapi-codegen (strict server, std-http); pgx v5; sqlc; goose; `golang.org/x/crypto/argon2`; a maintained Go chess library such as `github.com/corentings/chess` (check its current major version and license) |
| Database | PostgreSQL (latest stable) with the `citext` extension |
| E2E | Playwright |
| CI | GitHub Actions |
| License | GPL-3.0-or-later for the whole repo (chessground is GPL-3.0). All dependencies must be GPL-compatible. |

### 3.5 Development environment

- **Primary:** Windows 10, VS Code with the Claude Code extension, PowerShell or Git Bash. **Also supported:** Linux and macOS (CI runs on Ubuntu).
- Required tools: Git for Windows, the current Node LTS with pnpm, Go, and the owner's **local PostgreSQL** (databases `retrograde` and `retrograde_test`, credentials in `.env`). Docker (`pnpm db:up`) is an optional alternative.
- Root scripts: `dev`, `check`, `test:api`, `test:e2e`, `gen`, `db:migrate`, `seed`, `build`, `start` (run the production build locally), plus optional `db:up`/`db:down`. Each must work from cmd.exe, PowerShell and bash (see `CLAUDE.md`).
- `pnpm install` runs a `prepare` script that sets `git config core.hooksPath .githooks`, so the commit-msg hook is always active.
- The project lives in the folder the owner opened in VS Code. Its path may contain spaces, so every script quotes paths. If the folder is inside OneDrive, mention once that sync can slow `node_modules`, then carry on.

---

## 4. Engine core (`packages/engine`)

Correctness first, proved by perft. Then speed.

### 4.1 Representation

- 0x88 board in `Int8Array(128)`; piece codes `1..6` = P N B R Q K for White, negated for Black, `0` empty.
- `Position` fields: board, side to move, castling rights (4 bits KQkq), en passant square (or none), halfmove clock, fullmove number, king squares, piece counts per type and color, Zobrist key (`hi`, `lo` as 32-bit unsigned ints).
- Move encoding: a 32-bit int with from (7 bits), to (7 bits), promotion piece (3 bits) and flags (capture, double push, en passant, castle, promotion), plus captured piece stored on the undo stack.
- `makeMove` / `unmakeMove` with an undo stack. They update the Zobrist key incrementally.

### 4.2 FEN

- `parseFen(fen)` returns `Result<Position, FenError[]>`. It checks **syntax only**: 6 fields (or 4, defaulting the clocks), 8 ranks of 8 squares, valid piece letters, side `w|b`, castling `-` or a subset of `KQkq` in order, en passant `-` or a square on rank 3/6, non-negative clocks.
- Syntactically valid but illegal positions (2 white kings, pawn on rank 1) must parse successfully. The Lab needs them; legality is §5's job.
- `toFen(position)` round-trips any parsed FEN in canonical form.
- `targetKey(position)` returns placement + side to move.

### 4.3 Move generation

- Pseudo-legal generation, then a legality filter (make move, test own king attacked, unmake).
- Must handle every special case: castling (not out of, through or into check; path empty; right present), en passant including the horizontal-pin case (e.g. king and enemy rook on the same rank as both pawns), promotions to Q/R/B/N, double pushes, pins.
- `isSquareAttacked(position, square, byColor)` and `checkers(position)` are exported; the analyzer needs them.

### 4.4 Notation

- UCI: `moveToUci`, `uciToMove(position, uci)` (returns an error for illegal or malformed moves).
- SAN: `moveToSan` with correct disambiguation and `+`/`#` suffixes; `sanToMove` is lenient (accepts missing check marks, `0-0`, lowercase promotion).
- `replay(ucis: string[])` from the initial position returns the final position or `{ illegalAt: index }`.

### 4.5 Zobrist hashing

Keys from a fixed-seed PRNG (e.g. a small xorshift or splitmix32 implementation in `util/rng.ts`), so hashes are identical on every machine and run. Two 32-bit halves; no BigInt.

The hash covers piece placement, side to move, castling rights and the en passant file, but the en passant file is included **only when a pawn of the side to move could capture en passant** (pseudo-legally: a pawn on an adjacent file of the right rank, ignoring pins), as Stockfish does. Positions that differ only by an unusable en passant square therefore hash the same, so the solver's transposition table (§6.4) merges them. `toFen` still writes the en passant square after every double push (the standard FEN convention). (Decided 2026-10-22.)

### 4.6 Public API (sketch; refine in the Phase 1 plan)

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
```

### 4.7 Tests

Perft (node counts). Check these against chessprogramming.org "Perft Results" before relying on them.

| Position | FEN | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|---|
| Start | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | 20 | 400 | 8902 | 197281 | 4865609 |
| Kiwipete | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1` | 48 | 2039 | 97862 | 4085603 | 193690690 |
| Pos 3 | `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1` | 14 | 191 | 2812 | 43238 | 674624 |
| Pos 4 | `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1` | 6 | 264 | 9467 | 422333 | 15833292 |
| Pos 5 | `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8` | 44 | 1486 | 62379 | 2103487 | 89941194 |
| Pos 6 | `r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10` | 46 | 2079 | 89890 | 3894594 | 164075551 |

- Fast suite: all positions to the depth where count ≤ ~500,000. Slow suite: depth 5 for all, plus start position depth 6 (119060324).
- Property tests: FEN round-trip; `makeMove`+`unmakeMove` restores board and Zobrist key exactly; incremental Zobrist equals Zobrist recomputed from scratch; for every legal move in random positions, `sanToMove(moveToSan(m)) === m` and the same for UCI.
- Report perft nodes per second in `PROGRESS.md`. Aim for several million per second in Node.

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

Soundness rule: `illegal` only when the contradiction is certain. Never claim `legal` without a proof game. `deduction` findings are true facts about the position's history; they become the Lab's "detective notes".

**Deciding `legal`** (decided 2026-10-22). When no illegal finding exists, `analyzePosition` makes a quick proof attempt: `shortestProofGame` (§6) from the lower bound upward, honouring the FEN's claims (every stated castling right must survive to the end, and a stated en passant square must be the final one). Options `proofMaxPlies` (default 10), `proofTimeLimitMs` (default 750, separate from the last-move budget) and `proofNodeLimit` (default 1,000,000); `proofMaxPlies: 0` disables it. A found proof is replayed as a self-check and the verdict is `legal` with that (shortest) proof. Otherwise the verdict stays `undecided`: reason `search-limit` if the proof attempt or the last-move search was cut short, else `no-contradiction-found` (also when the lower bound alone exceeds `proofMaxPlies`). No proof within N plies never makes a position illegal.

### 5.2 Static rules

Each rule has a `RuleId`, a test that triggers it and a test that it stays silent on legal positions. Message templates are examples; keep them that clear.

| RuleId | Severity | Check | Example message |
|---|---|---|---|
| `KING_COUNT` | illegal | Exactly one king per side | "White has 2 kings. Each side has exactly one king." |
| `PAWN_ON_BACK_RANK` | illegal | No pawn on rank 1 or 8 | "The white pawn on h1 is impossible: pawns never stand on the first or last rank." |
| `TOO_MANY_PIECES` | illegal | ≤ 16 pieces per side | "Black has 17 pieces but started with 16." |
| `TOO_MANY_PAWNS` | illegal | ≤ 8 pawns per side | |
| `PROMOTION_EXCESS` | illegal | `pawns + minPromotions ≤ 8`, where `minPromotions = max(0,Q−1) + max(0,R−2) + max(0,N−2) + max(0,lightB−1) + max(0,darkB−1)` | "White has 3 queens, so at least 2 were promoted. With 7 pawns still on the board that's 9 pawns, but White only had 8." |
| `OPPONENT_IN_CHECK` | illegal | The side *not* to move is not in check | "It's White to move, but the black king on e8 is in check from the rook on e7. Black's last move would have left its own king in check." |
| `TOO_MANY_CHECKERS` | illegal | The side to move has at most 2 checkers | "The black king is in check from 3 pieces at once; one move can create at most a double check." |
| `PAWN_STRUCTURE_IMPOSSIBLE` | illegal | A side's pawns can be assigned to distinct starting files at all (§5.2.1) | "The white pawn on a3 has no possible starting file: it could only have come from the a- or b-file, and both of those pawns are still on rank 2." |
| `PAWN_CAPTURES_EXCEED_MISSING` | illegal | Min captures made by a side's pawns ≤ opponent's missing pieces (§5.2.1) | "White's pawns needed at least 1 capture to get where they are (the doubled c-pawns), but all 16 black pieces are still on the board." |
| `CASTLING_RIGHTS_INCONSISTENT` | illegal | Every claimed castling right has king and rook on their original squares | "The FEN says White can castle kingside, but the white king is on f1." |
| `EN_PASSANT_INCONSISTENT` | illegal | En passant square set ⇒ the matching pawn just double-pushed: pawn on rank 4/5 behind the square, ep square and the pawn's start square empty, side to move matches | |
| `NO_POSSIBLE_LAST_MOVE` | illegal | Not the initial position, and no viable retraction at depth 1 (§5.4) | "There's no move Black could have just played to reach this position." |
| `NO_POSSIBLE_HISTORY` | illegal | There are viable retractions at depth 1, but at the analysed depth k > 1 every one of them is definitely not viable (§5.4) | "Every move White could have just played leads back to a position with no possible last move (checked 3 moves deep)." |
| `PROMOTED_PIECE_REQUIRED` | deduction | Same formula as `PROMOTION_EXCESS` > 0 | "At least one white bishop is a promoted pawn: White has two dark-squared bishops." |
| `CAPTURES_REQUIRED` | deduction | Lower bound of captures by each side's pawns > 0 | "White's pawns made at least 2 captures." |
| `CASTLING_LOST` | deduction | King or rook not on its original square | "White can no longer castle kingside: the h1 rook has moved." |
| `LAST_MOVE_FORCED` | deduction | Exactly one distinct last move (UCI) among the viable retractions at the requested depth. Retractions that differ only in the piece un-captured count as one move. | "Black's last move must have been …Kh8-g8." / "Black's last move must have been …Kxg8, capturing a knight or a bishop." |

#### 5.2.1 Pawn capture accounting (the matching rule)

Every pawn starts on its own file. Each file change needs one capture. For one color:
- Let the current pawns be p₁..pₖ (k ≤ 8) and the starting files be a..h.
- Cost of assigning pawn pᵢ on file f to starting file s is `|f − s|`. It's infinite if the pawn couldn't have reached its rank from rank 2 (rank 7 for Black) with that many file changes: the file distance must be ≤ the rank distance travelled.
- Min-cost assignment of pawns to distinct starting files gives the minimum number of captures by those pawns. With at most 8 pawns and 8 files it's computed exactly by dynamic programming over bitmasks of used files: `best[mask]` is the cheapest way to assign the first `popcount(mask)` pawns to the files in `mask` (at most 2⁸ states × 8 files). (Decided 2026-10-22; replaces the Hungarian algorithm, same result, simpler code.)
- If no assignment with finite cost exists, the position is illegal by `PAWN_STRUCTURE_IMPOSSIBLE`. A maximum matching on the finite-cost edges leaves some pawn X unmatched; following alternating paths from X gives a group S of pawns whose possible files N(S) number exactly |S| − 1, a violation of Hall's condition. The message names X and that group, and highlights the whole group, e.g. "3 white pawns (a2, b2, a3) could only have started on the a- and b-files, so the pawn on a3 has no possible starting file." Example position: white pawns on a2, b2, a3, b3.
- If that minimum exceeds the opponent's missing pieces (16 − opponent piece count), the position is illegal by `PAWN_CAPTURES_EXCEED_MISSING`.

This ignores promoted pawns and pieces captured by non-pawns. That's a relaxation, so the bound stays valid. A tighter version is a stretch goal (§5.6).

### 5.3 Retraction generator

`retractions(p: Position): Retraction[]`, where a `Retraction` holds the prior position, the forward move (UCI) and its kind: `normal | uncapture | unpromotion | unpromotion-uncapture | un-en-passant | uncastle`.

The retractor is the side not to move in P. For each retractor piece:

- **Normal un-move.** Move the piece backwards along its movement pattern to an empty square. Sliders retract through empty squares only. Pawns retract one square back, or two squares if standing on their 4th rank (white rank 4, black rank 5) with the square between empty. No pawn may retract onto its own first rank.
- **Un-capture.** Same geometry (pawns: diagonally backwards), then place an opponent piece of type P, N, B, R or Q on the vacated square. No pawn on rank 1/8; the opponent's material must still pass `TOO_MANY_PIECES`, `TOO_MANY_PAWNS` and `PROMOTION_EXCESS`.
- **Un-promotion.** A retractor Q/R/B/N on its last rank becomes a pawn one rank back: same file (non-capture) or adjacent file (with un-capture).
- **Un-en-passant.** A retractor pawn on its 6th rank on file f retracts diagonally to its 5th rank. An opponent pawn reappears on file f, 5th rank (from the retractor's view), and the square on file f two ranks ahead of that must be empty. The prior position gets the en passant square set.
- **Un-castling.** King on g1 with rook on f1, and e1/h1 empty (queenside: king c1, rook d1, a1/b1/e1 empty), mirrored for Black. The prior position restores the castling right. The king must not have been in check in the prior position, and neither may the square it passed.

Validity of each candidate prior position P′:
1. In P′ it's the retractor's turn, so the opponent's king must not be in check in P′.
2. If P has an en passant square, the only valid retraction is the matching double push.
3. **Confirm by forward generation.** Generate the legal moves of the moved piece in P′ (the moves from its square, plus castling for a king) and check that one of them produces P: compare placement and side to move; compare the en passant square **only when P states one**; and require the move to keep **every castling right P states** (rights after the move ⊇ rights of P). Stated castling rights and a stated en passant square are claims about the history; `-` claims nothing. An en passant field of `-` means "not stated", not "the last move wasn't a double push" (many FENs, including hand-typed ones, write `-` after a double push). Rule 2 already handles the case where P states one. This guarantees soundness by construction; the soundness property test (§5.5) checks it independently with the full legal move generator. (Decided 2026-10-22.)

Castling rights simplification: a normal retraction copies P's castling rights into P′ (an un-castling adds the right it used). P′ might have had more rights, but the extra rights can't be known and don't affect other retractions. Likewise P′ has no en passant square unless the retraction is an un-en-passant, its halfmove clock is 0, and its move number is one less when Black is the retractor (never below 1).

### 5.4 Last-move analysis

`lastMoves(p, { depth, timeLimitMs, nodeLimit, shouldStop })`:
- A retraction to P′ is **viable at depth k** (k ≥ 1) if P′ passes every static rule *except* `NO_POSSIBLE_LAST_MOVE` (that rule is defined by viability, so including it would be circular), **and** one of these holds: k = 1; P′ is the initial position; or P′ has a retraction that is viable at depth k−1. (Decided 2026-10-22, see `DECISIONS.md`.)
- Output: every depth-1 retraction with its viability at the requested depth, described in words ("White's last move could have been Bf1xb5, capturing a black knight").
- Each retraction's viability is **viable**, **not viable** or **unknown** (a time, node or stop limit cut the search short). Depth 1 needs only the static rules, so it is always decided.
- No viable retraction at depth 1 ⇒ `NO_POSSIBLE_LAST_MOVE`. Viable retractions at depth 1 but every one definitely not viable at the requested depth k > 1 ⇒ `NO_POSSIBLE_HISTORY` (sound, since retractions are complete and static rules are sound). Exactly one distinct move (UCI) among the viable retractions, with every other retraction definitely not viable ⇒ `LAST_MOVE_FORCED`. If that move has several viable un-captures, the message lists the possible captured pieces ("…capturing a knight or a bishop"). Nothing is claimed from an unknown result.
- Results are cached by an exact key (placement, side to move, castling rights, en passant square), never by hash alone, so a hash collision can't produce a false claim.
- Halfmove clocks, repetition and the 50/75-move rules are ignored.

### 5.5 Tests

- **Completeness (property).** For random positions P from seeded random play: for every legal move m from P to Q, `retractions(Q)` contains a retraction that gives back P (placement + side + ep).
- **Soundness (property).** For every retraction of Q to P′, some legal move in P′ produces Q. This holds by construction (§5.3 step 3), but test it anyway.
- Run 2,000 positions in the fast suite and 50,000 in the slow suite.
- **Curated fixtures** in `packages/engine/test/fixtures/positions.json`: at least 30 positions, each with the expected verdict, rule ids and a one-line comment explaining why. Include at least these:

| FEN | Expected |
|---|---|
| `k7/8/8/8/8/8/8/K6P w - - 0 1` | illegal: `PAWN_ON_BACK_RANK` |
| `4k3/4R3/8/8/8/8/8/4K3 w - - 0 1` | illegal: `OPPONENT_IN_CHECK` |
| `4k3/8/3N4/1B6/8/8/8/4R2K b - - 0 1` | illegal: `TOO_MANY_CHECKERS` (rook e1, knight d6, bishop b5) |
| `4k3/8/8/8/8/8/PPPPPPPP/QQ2K3 w - - 0 1` | illegal: `PROMOTION_EXCESS` |
| `rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1` | illegal: `PAWN_CAPTURES_EXCEED_MISSING` (b-pawn reached c3 by capturing, but Black is missing nothing) |
| `4k3/8/8/8/8/8/8/5K1R w K - 0 1` | illegal: `CASTLING_RIGHTS_INCONSISTENT` |
| `4k3/8/8/8/8/8/8/4K3 w - e6 0 1` | illegal: `EN_PASSANT_INCONSISTENT` |
| `rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2` | legal, proof `e2e4 e7e5`. Written with `-`, so …e7-e5 must still be listed as a possible last move (§5.3 step 3). |
| `8/8/8/8/8/8/8/K6k w - - 0 1` | undecided (needs a long proof game) |
| `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1` | undecided in v1. It's actually illegal by a parity argument (with every pawn home, only knights can move, plus a rook into a vacated knight square; every trip back home takes an even number of moves, so White can't have made one more move than Black). Proving it is stretch rule `PARITY` (§5.6). Use this example in `docs/learning`. |

Claude Code should construct the remaining fixtures and verify each one by reasoning in its comment, plus by the solver where possible.

### 5.6 Stretch rules (only after Phase 3 is done, and only if time allows)

`PARITY` (tempo/parity arguments as above), caged pieces (a bishop that can't have left its home square behind unmoved pawns), and capture accounting that includes promoted pawns and the colors of captured bishops.

---

## 6. Proof-game solver (`packages/engine/src/solver`)

### 6.1 Problem

Given a target key T and a ply count N, find (or count) all move sequences of exactly N plies from the initial position whose final position matches T.

```ts
interface SolveOptions {
  plies: number;
  mode: 'find-one' | 'find-all' | 'count';
  cap?: number;                  // stop counting/collecting once this many are found
  timeLimitMs?: number;
  nodeLimit?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: { nodes: number; elapsedMs: number }) => void;
  castling?: string;             // rights (subset of "KQkq") that must still hold at the end; default none
  enPassant?: string;            // en passant square the final position must have; default not required
  ttBits?: number;               // transposition table size 2^ttBits entries (default 20, about 13 MB)
}
interface SolveResult {
  status: 'complete' | 'limit' | 'aborted';
  solutions: string[][];         // UCI sequences (find modes)
  count: number;                 // exact if status === 'complete' and count < cap
  nodes: number;
  elapsedMs: number;
}
export function solveProofGame(target: string, opts: SolveOptions): SolveResult;
export function shortestProofGame(target: string, maxPlies: number, opts?: Omit<SolveOptions, 'plies' | 'mode' | 'cap'>): ShortestResult;
interface ShortestResult {
  status: 'complete' | 'limit' | 'aborted';
  plies: number | null;          // length of the proof found
  solution: string[] | null;     // complete + solution: a proven shortest proof game; complete + null: none up to maxPlies
  nodes: number;
  elapsedMs: number;
  searched: number[];            // ply counts searched completely without a solution
}
```

`count` is exact when the status is `complete` and the count is below `cap`; otherwise it's a lower bound. `castling` and `enPassant` serve `analyzePosition` (§5.1); daily puzzles compare the target key only. Repetition and the 50-move rule are ignored.

`shortestProofGame` tries N = the smallest value with the right parity (target side to move fixes N's parity) that is ≥ the lower bound from the start position, then N + 2, and so on up to `maxPlies`.

### 6.2 Per-side move budgets

After k plies, r = N − k plies remain. If White is to move, White has `ceil(r/2)` moves left and Black `floor(r/2)`; if Black is to move, swap them. Prune a node whenever **either** side's lower bound exceeds its own budget. Separating the budgets is much stronger than one combined bound.

### 6.3 Lower bound h(P, T), computed per side

For side S, h_S is the maximum of:
1. **Displacement cost.** For each piece type (light- and dark-squared bishops count as separate types), a min-cost matching between S's current pieces and S's target pieces of that type. Use empty-board distances, which never overestimate:
   - King: Chebyshev distance.
   - Knight: precomputed BFS table.
   - Bishop: 0 same square, 1 same diagonal, 2 same square color, ∞ otherwise.
   - Rook / Queen: 0, 1 or 2.
   - Pawn (White), with `dr` = ranks to advance and `df` = files to change: ∞ if `dr < 0` or `|df| > dr`. Otherwise every move advances exactly one rank except a double push, which needs two straight ranks at the start. So the cost is `dr − 1` if the pawn is on rank 2 and `dr − |df| ≥ 2`, else `dr`. (A tempting shortcut that only allows the double push when `df == 0` overestimates, e.g. e2→f5 via e4 and exf5 is 2 moves, not 3.) Mirror for Black.
   - Extra current pieces (to be captured) cost S nothing.
   - **Promotions** (decided 2026-10-22; corrects the original wording). Let E = (current pawns of S) − (target pawns of S): the most pawns S can still promote. Any non-pawn target piece may be explained as a promoted pawn at cost 0 instead of being matched to a current piece, at most E times **per type**. Forcing a match would overestimate: with a white knight far from the target knight's square and a white pawn on the 7th rank that can promote there in one move (the old knight being captured later, which costs White nothing), the true cost is 1 but a forced knight match says 4. Allowing E per type is a relaxation of the real limit (E in total), so the bound stays admissible. The pawn promotions themselves cost nothing here, because extra current pawns are free.
2. **Captures S must make**: (opponent pieces now) − (opponent pieces in target). Each capture is a separate move of S.

Feasibility pruning (return "impossible"):
- Target piece count of S > current piece count of S (pieces never come back).
- Target pawns of S can't be perfectly matched to current pawns of S.
- Unmatched target non-pawn pieces of S > current pawns of S − target pawns of S (not enough pawns left to promote), where "unmatched" counts, per type, the target pieces beyond the current pieces of that type.

**The castling trap.** Castling moves king and rook in one move. Naive distances make the bound overestimate, which silently breaks the search. While S still has a castling right:
- King cost = min(normal distance, 1 + distance from the castled king square to the target).
- Rook on its original corner with that right = min(normal distance, distance from its castled square to the target), counting the rook's part as free.

The castling move then counts once (through the king), so the bound stays admissible.

**Admissibility property test (mandatory).** Play a seeded random game of N plies to get T. For every prefix position Pᵢ, h_White(Pᵢ, T) ≤ White's remaining moves and h_Black(Pᵢ, T) ≤ Black's remaining moves. Run it over thousands of random games, including games with castling, promotions and en passant, and games where a side promotes to a piece type it already has and the original piece is captured later (the pattern that breaks a forced matching); the test asserts each of these occurs. Any change to h must keep it green.

### 6.4 Search

- Depth-first search with the exact remaining ply count; prune with §6.2/§6.3; when r = 0, compare target keys.
- In find modes, order moves by decreasing bound improvement.
- **Memoized counting.** A transposition table keyed by (Zobrist key including castling and en passant, remaining plies) stores the solution count from that node, saturated at `cap`. (The Zobrist key includes the en passant file only when a capture is possible, §4.5; positions differing only by an unusable en passant square have identical futures, so sharing an entry is correct.) This turns repeated subtrees into a lookup and makes uniqueness checks (`cap = 2`) cheap. Use a fixed-size table with an always-replace or depth-preferred scheme; store the full key to rule out collisions. In find modes the same table records dead ends (count 0) so they're never searched twice. Never store a result for a subtree that was cut short by a limit or abort.
- Progress callback about every 50,000 nodes; check `shouldStop`, `timeLimitMs` and `nodeLimit` at the same interval.

### 6.5 Tests

- Admissibility property test (above).
- **Brute-force cross-check.** Enumerate every game of exactly N plies from the start position, group by target key and count sequences. For N ≤ 4 (fast suite, 197,281 games at N = 4) compare against `solveProofGame(…, mode: 'count')` for a sample of at least 500 targets. N = 5 in the slow suite.
- Every random N-ply game's target must be solvable at N plies (status `complete`, count ≥ 1).
- `bench` script: solve 50 targets from random games at N = 6, 8, 10 and print median/p95 time and nodes. Record the results in `PROGRESS.md`. If the median at N = 8 is above about 5 seconds in Node, profile and improve before moving on.

---

## 7. Puzzle generator (`apps/generator`)

### 7.1 CLI

```
generator generate --count 500 --seed 42 --min-plies 5 --max-plies 12 --jobs 4 --out puzzles.jsonl [--source beam|random|both] [--node-limit N] [--width W] [--children C] [--random R]
generator verify puzzles.jsonl
generator stats puzzles.jsonl
```

Defaults: `--node-limit 200000`, `--width 180`, `--children 8`, `--random` 4 × count, `--jobs 1`. `generate` also writes `<out>.stats.json` (per-ply acceptance and timings); it is separate so the JSONL itself stays byte-identical across runs. `verify` replays every solution, re-runs the solver checks and recomputes features, score and stars. (Decided 2026-10-23.)

`--jobs` uses `worker_threads`. Each candidate index gets a seed derived from `--seed`, and output is sorted by candidate index. Searches are bounded by **node limits, never time limits**, so a candidate's verdict doesn't depend on machine speed, and the output is byte-identical for a given seed and engine version **whatever `--jobs` is**. (Decided 2026-10-22.)

### 7.2 Pipeline per candidate

**Candidate sources** (decided 2026-10-22). Random games are almost never unique beyond about 8 plies, because independent moves can be played in another order. The main source is therefore a **beam search** that grows puzzles one ply at a time from accepted ones. If a game of N + 1 plies is the unique shortest proof game for its target, its first N plies are the unique shortest proof game for that position's full state (placement, side, castling, en passant); for the target key alone this can fail only when the last move is castling or en passant, the only moves whose legality depends on those fields. So every candidate is an accepted puzzle plus one legal move. Per parent, extensions whose last move could have been played at an earlier turn of the same side (a free, sound non-uniqueness test) are dropped, and the 8 most interesting of the rest are verified (more while the frontier is small, about W × 8 per ply). The frontier (W = 180) is kept diverse: at most max(3, W / parents) children per parent; at most W/6, W/12, W/15 and 2 puzzles sharing their first 1, 2, 4 and 6 plies (the last so the pool's prefix cap below can be met at every length); a preference for captures, promotions, castling, en passant, switchbacks and checks, and no lines where a side's last three moves are quiet king moves. (Details decided 2026-10-23.) Random-game sampling (step 1 below) remains a second source. The beam still verifies castling and en passant extensions, but it can miss a puzzle ending in one whose prefix isn't unique; random games can find those, though rarely (none of the 500 in `data/puzzles-v1.jsonl`).

1. (Random source) Sample a random legal game of N plies (N drawn from the allowed range) with **biased move selection** to make interesting puzzles: captures ×3, promotions ×5 (underpromotions ×8), castling ×3, en passant ×6, a piece returning to a square it visited ×2, other moves ×1. Tune these weights and record the final ones in `DECISIONS.md`.
2. Target = `targetKey` of the final position.
3. **Unique:** `count` at N with `cap = 2` must be exactly 1 with status `complete`. This runs first because it fails most often and stops as soon as it finds a second solution; running the exhaustive shortest checks first would make every shortest-but-not-unique candidate pay for them. (Decided 2026-10-22.)
4. **Shortest:** `count` at N − 2, N − 4, … down to the lower bound must all be 0 with status `complete`.
5. Detect features and compute difficulty (§7.3); emit a record.

Candidates that hit a limit are discarded, never emitted. `stats` reports acceptance rate and time per candidate by N. The final pool is chosen from the accepted puzzles with per-ply quotas (about 15% at 5–6 plies, 28% at 7–8, 15% at 9, 28% at 10–11, 14% at 12) and at most 3 puzzles sharing a 6-ply prefix, highest scores first. Quotas are filled longest first, because long puzzles are scarce and share prefixes with shorter ones.

### 7.3 Features and difficulty

Features detected from the solution, following each piece by identity: `capture`, `promotion`, `underpromotion`, `castling`, `en-passant`, `switchback` (a piece returns to a square it left, by another way), `tempo` (a piece goes straight back: A→B→A; counted as tempo, not switchback), `king-walk` (one side's king moves ≥ 2 times, castling not counted), `phoenix` (a side promotes to a piece type of which an original, unpromoted piece of that side is captured in the game).

Difficulty, a starting formula to tune with real data:
`score = plies + 1.5·(captures) + 3·promotions + 4·underpromotions + 2·castling + 3·enPassant + 2·switchbacks + 2·tempo + log2(solverNodes) / 4`, rounded to 2 decimals.

`solverNodes` is the node count of the uniqueness check (count at N with cap 2): how much work it takes to see there is exactly one game. (Originally the nodes of a separate find-one search; changed 2026-10-23 to save that search.)

The score maps to 1–5 stars by quantiles of the generated pool, with cut points chosen to match the weekly ramp (§8.7): the lowest 1/7 of scores is ★, up to 3/7 is ★★, up to 5/7 is ★★★, up to 6/7 is ★★★★, and the top 1/7 is ★★★★★. So the pool's level mix matches how often each level is scheduled (★ 1 day a week, ★★ 2, ★★★ 2, ★★★★ 1, ★★★★★ 1). Rough intended ply ranges: ★ 5–6, ★★ 7–8, ★★★ 8–9, ★★★★ 10–11, ★★★★★ 12 or special features.

### 7.4 Output (one JSON object per line)

```json
{"id":"g42-000137","plies":2,"target":"rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w","solution":["g1f3","g8f6"],"features":[],"difficulty":1,"score":2.0,"solverNodes":41,"engineVersion":"0.4.0","seed":42}
```

(A valid but deliberately tiny example: 1.Nf3 Nf6 is the only 2-ply game reaching that position. Real puzzles use 5–12+ plies, and the numeric fields here are made up.) Ids are `g{seed}-{index}` with the candidate index zero-padded to 6 digits; random-source candidates are indexed from 1,000,000. Lines are sorted by index.

### 7.5 Content policy

Only generated puzzles. Don't copy composed problems from books, magazines or databases.

---

## 8. Daily Proof Game

### 8.1 Rules

- Today's puzzle shows the target position, its difficulty, and its length ("Reach this position in 4.5 moves · 9 plies").
- A guess is a complete legal game from the initial position of exactly N plies.
- Six guesses. A guess whose final target key equals the target solves the puzzle. Because puzzles are unique, this means the player found the solution; accept any game that reaches the target anyway.
- After six wrong guesses, the attempt fails and the solution is revealed.

### 8.2 Input

- The player plays moves on the board starting from the initial position. Chessground only allows legal moves (destinations from `legalMoves`). Promotions open a picker.
- Visible: move list in SAN, ply counter (`5 / 9`), Undo, Reset, and a small target board.
- A "difference overlay" toggle highlights squares where the current board differs from the target. It's computed client-side from the public target, so it leaks nothing.
- Submit is enabled only at exactly N plies.
- Previous guesses appear as rows of feedback cells. Tapping a row replays that guess on the board.

### 8.3 Feedback algorithm (computed by the server)

Per ply i, compare the guess move gᵢ to the solution move sᵢ (UCI strings):
1. **Green (`G`, 🟩, ✓ icon):** gᵢ == sᵢ. Mark solution ply i as used.
2. **Yellow (`Y`, 🟨, ↔ icon):** otherwise, if gᵢ equals an unused solution move sⱼ, j ≠ i, **at a ply of the same color** (j ≡ i mod 2). Process plies left to right and mark the leftmost such j as used.
3. **Gray (`X`, ⬛, ✕ icon):** otherwise.

Greens are assigned in a first pass before any yellows, as in Wordle. The feedback string has length N, e.g. `YGYGGX`.

Test vectors (put these in `fixtures/feedback-vectors.json` and test them in Go):

| Solution | Guess | Feedback |
|---|---|---|
| `e2e4 e7e5 g1f3 g8f6 f3g1 f6g8` | `g1f3 e7e5 e2e4 g8f6 f3g1 b8c6` | `YGYGGX` |
| `g1f3 g8f6 f3g1 f6g8 g1f3 b8c6` | `g1f3 b8c6 f3g1 c6b8 g1f3 g8f6` | `GYGXGY` |
| `g1f3 g8f6 f3g1 f6g8 g1f3 b8c6` | `g1f3 g8f6 f3g1 f6g8 g1f3 g8f6` | `GGGGGX` |

Add at least 10 more, including a guess identical to the solution (`G…G`) and one with no matching moves (`X…X`).

### 8.4 Hints (each is recorded and costs ranking)

1. **Movers:** which piece types moved at least once, per color ("White: knight, pawn · Black: knight").
2. **Captures:** the plies where captures happen, or "no captures".
3. **One move:** reveals the solution move at the first ply that isn't green in the player's most recent guess. If the player hasn't guessed yet, it reveals the first move of the solution (ply 1). (Decided 2026-10-22: the older "not green in any guess so far" wording could leave nothing to reveal when different guesses together cover every ply.)

Hints are served by the server, in order, one per request.

### 8.5 Results, ranking and stats

- Daily leaderboard ordering: solved first, then fewer guesses, then fewer hints, then shorter solve time (`finished_at − started_at`, where `started_at` is when the server first sent today's puzzle to that player).
- Streak: consecutive UTC days with a solved daily (archive play doesn't count). A solve counts for the puzzle's own day, even if it finishes after midnight UTC (§10.5). Track current and max streak.
- Profile stats: played, solved, win %, current/max streak, guess distribution (1–6 and failed), average hints.

### 8.6 Share card (copied to clipboard)

```
Retrograde #142 ★★★ · 4.5 moves
3/6 · 🔍1
🟨🟩⬛🟩⬛⬛🟩🟩🟨
🟩🟩🟨🟩🟩⬛🟩🟩🟩
🟩🟩🟩🟩🟩🟩🟩🟩🟩
https://<BASE_URL>/daily
```

A failed attempt shows `X/6`. With no hints, omit the `🔍n` part. An archive (practice) attempt's card says `Retrograde #142 (practice)` and links to `https://<BASE_URL>/daily/142` (decided 2026-10-29).

### 8.7 Scheduling and archive

- Weekly difficulty ramp: Mon ★, Tue ★★, Wed ★★, Thu ★★★, Fri ★★★, Sat ★★★★, Sun ★★★★★.
- `retrograde schedule --from YYYY-MM-DD --days 365` deterministically assigns unscheduled puzzles by weekday difficulty (the lowest unscheduled puzzle id of that level; days already scheduled are kept) and fails loudly if the pool runs out of a level. It always prints how many unscheduled puzzles of each level remain (after scheduling, or at the point of failure).
- A year needs about 53 each of ★, ★★★★ and ★★★★★ and about 105 each of ★★ and ★★★, which is why the pool has at least 500 puzzles with ramp-shaped cut points (§7.3).
- Puzzles from earlier days are playable in archive mode: same UI, attempts flagged `archive`, excluded from leaderboards and streaks. The solution is still revealed only after finishing.

### 8.8 Guests

Starting a puzzle (`POST /daily/{number}/start`) without a session creates a guest player and an anonymous session cookie; reading a puzzle (`GET`) creates nothing. Guests play the daily and appear on no leaderboard. Guest players older than 30 days with no guesses are deleted by the cleanup job, along with expired sessions. (Decided 2026-10-23.) When a guest registers or signs in, their attempts move to the account for any puzzle the account hasn't played yet (§10.6).

---

## 9. Lab

### 9.1 Layout

Board editor (drag pieces from a palette and off the board; chessground supports dropping new pieces), FEN input with inline syntax errors, side-to-move toggle, castling and en passant fields, "Start position" and "Clear" buttons. On a phone the report sits below the board; on wide screens beside it.

### 9.2 Report

- **Verdict banner:** Illegal / Legal (proved) / Undecided, with a one-sentence reason.
- **Detective notes:** all findings in plain English. Hovering or tapping a note highlights its squares and arrows on the board.
- **Possible last moves:** depth-1 retractions with viability at depth 3 by default (adjustable 1–6), each with a "Take it back" button that loads the prior position.
- **Prove it:** runs `shortestProofGame` up to 16 plies with a progress indicator and Cancel. A found proof plays back step by step with a scrubber.

Analysis runs automatically (debounced ~300 ms) after edits; Prove runs only on request.

### 9.3 Permalinks and examples

The URL holds the position (`/lab?fen=…`, URL-encoded), so any analysis can be shared. "Copy link" copies it, and "Open in Lichess" opens the position in Lichess's board editor. An example gallery shows 8–10 fixture positions with teaser titles ("Who moved last?", "Count the captures", "The impossible start"). (Buttons added 2026-10-23.)

### 9.4 Worker protocol

The engine worker is exposed with Comlink: `analyze(fen)`, `lastMoves(fen, depth)`, `prove(target, maxPlies)` (with progress via a Comlink proxy callback). Cancel = `worker.terminate()`, then create a fresh worker. The UI shows "Cancelled" rather than an error.

---

## 10. Backend: API and data model (`services/api`)

### 10.1 Layout

- `cmd/retrograde`: one binary with subcommands `serve`, `migrate`, `import-puzzles <file.jsonl>`, `schedule --from --days`.
- `internal/config`: env parsing and validation (fail fast on startup).
- `internal/httpapi`: generated server interface implementation, middleware (request ID, logging, recover, security headers, rate limits, CSRF/origin check), problem+json errors.
- `internal/auth`: passwords, sessions, guests, merge, Lichess OAuth.
- `internal/daily`: puzzle of the day, attempts, guesses, feedback, hints, streaks. Pure functions where possible.
- `internal/leaderboard`, `internal/chessrules` (adapter around the Go chess library: `Replay(ucis) (targetKey, error)`), `internal/store` (sqlc + transaction helper), `internal/clock`, `internal/webui` (embedded `dist/`, SPA fallback to `index.html`). `go:embed` can't read files outside the Go module, so the build copies `apps/web/dist` into `services/api/internal/webui/dist` (gitignored) before compiling the binary.

### 10.2 Configuration (environment)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:<password>@localhost:5432/retrograde?sslmode=disable` | Development database |
| `TEST_DATABASE_URL` | `postgres://postgres:<password>@localhost:5432/retrograde_test?sslmode=disable` | Used only by integration tests |
| `HOST` | `127.0.0.1` (default), `0.0.0.0` in a container | Listen address. The default keeps the dev server private to the machine (no Windows firewall prompt). |
| `PORT` | `8080` | |
| `BASE_URL` | `http://localhost:5173` in dev | Used for redirects, origin checks, share links |
| `LAUNCH_DATE` | `2026-11-01` | Puzzle #1 date (UTC); `number = days since LAUNCH_DATE + 1`, and nothing is scheduled before it. Local development: `pnpm seed` sets it to 14 days before today when `.env` doesn't have it. |
| `COOKIE_SECURE` | `true` in production | |
| `LICHESS_BASE_URL` | `https://lichess.org` | Overridable for tests |
| `LICHESS_CLIENT_ID` | `retrograde` | Lichess PKCE needs no registration; any stable id works (verify in Lichess docs) |
| `LOG_LEVEL` | `info` | |
| `TRUSTED_PROXIES` | `10.0.0.0/8,127.0.0.1` | Comma-separated IPs/CIDRs. `X-Forwarded-For` is honoured only when the direct peer is in this list; otherwise the client IP is the TCP peer address. Empty (the default) trusts no proxy. Used for per-IP rate limits and logs. |
| `RATE_LIMIT_SCALE` | `1` (default) | Multiplies every rate limit. Only the e2e tests raise it; the API logs a warning at startup whenever it isn't 1. (Decided 2026-10-29.) |

### 10.3 Data model (sketch; finalize in Phase 6)

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id               bigserial PRIMARY KEY,
  username         citext UNIQUE NOT NULL,          -- 3–20 chars [A-Za-z0-9_-]
  password_hash    text,                             -- argon2id PHC string; null for Lichess-only users
  lichess_user_id  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE players (                               -- every visitor is a player; guests have user_id NULL
  id          bigserial PRIMARY KEY,
  user_id     bigint UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,                   -- sha256 of the random token; the token itself is only in the cookie
  player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE TABLE puzzles (
  id              bigserial PRIMARY KEY,
  external_id     text UNIQUE NOT NULL,              -- generator id, makes import idempotent
  plies           int  NOT NULL CHECK (plies BETWEEN 1 AND 40),
  target          text NOT NULL,                     -- target key
  solution        text[] NOT NULL,                   -- UCI; NEVER returned before the attempt finishes
  difficulty      smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  features        text[] NOT NULL DEFAULT '{}',
  solver_nodes    bigint NOT NULL,
  engine_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_schedule (
  day        date PRIMARY KEY,
  number     int UNIQUE NOT NULL,
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
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  UNIQUE (player_id, puzzle_id)
);

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
  guess_dist      int[] NOT NULL DEFAULT '{0,0,0,0,0,0,0}'   -- 1..6 guesses, index 7 = failed
);

CREATE TABLE oauth_states (
  state_hash     bytea PRIMARY KEY,
  code_verifier  text NOT NULL,
  player_id      bigint REFERENCES players(id) ON DELETE CASCADE,   -- guest to merge
  return_to      text NOT NULL,
  expires_at     timestamptz NOT NULL
);
```

Add indexes needed by the leaderboard and expiry queries; check them with `EXPLAIN`.

### 10.4 Endpoints

All paths are under `/api`. JSON in and out; errors use `application/problem+json`.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness + DB ping: 200 `{"status":"ok","db":"ok"}`, or 503 `{"status":"unavailable","db":"error"}` if the database doesn't answer within 2 seconds |
| `GET /auth/me` | session | Current player: `{ guest: bool, username?, stats }` |
| `POST /auth/register` | session (guest ok) | `{username, password}` → creates user, merges guest, rotates session |
| `POST /auth/login` | session (guest ok) | Same merge and rotation |
| `POST /auth/logout` | session | Deletes the session |
| `GET /auth/lichess/start?return_to=` | none | 302 to Lichess authorize URL (§10.6) |
| `GET /auth/lichess/callback` | none | Completes OAuth, 302 to `return_to` |
| `GET /daily` | session optional; creates nothing | Today's puzzle: `{number, day, plies, target, difficulty, attempt?: {status, guesses[{moves, feedback}], hintsUsed, hints[]}, solution?}` (`attempt` only if the caller has started this puzzle; `solution` only when finished) |
| `GET /daily/{number}` | session optional; creates nothing | Same shape for an archive puzzle (number ≤ today's) |
| `POST /daily/{number}/start` | creates guest session if missing | Starts the caller's attempt (`started_at`), idempotent; returns the same shape as `GET`. Rate limit 300 per IP per hour. (Decided 2026-10-23.) |
| `POST /daily/{number}/guesses` | session | `{moves: string[]}` → `{feedback, status, solution?}` |
| `POST /daily/{number}/hints` | session | Next hint → `{hintIndex, hint}` |
| `GET /leaderboards/daily/{number}?limit=100` | none | Top entries + the caller's own rank if signed in |
| `GET /leaderboards/all-time?metric=current_streak\|max_streak\|solved` | none | Top 100 |
| `GET /users/{username}` | none | Public profile and stats |
| `GET /archive?page=` | none | Past puzzles: number, day, difficulty, plies (and the caller's result if any) |

### 10.5 Guess submission (one transaction)

1. Reject a request body with more than 40 moves (400) before touching the database. Resolve the puzzle by number; reject future numbers (404).
2. Load the attempt created by `POST /daily/{number}/start` (409 if the puzzle hasn't been started); `SELECT … FOR UPDATE` the attempt row. `is_archive = number < today's number` is fixed when the attempt is created and never recomputed, so an attempt started before 00:00 UTC and finished after it still counts as a daily (not archive) attempt, and its solve counts for the **puzzle's own day** (streaks and the daily leaderboard).
3. Reject if the attempt is finished (409) or already has 6 guesses (409).
4. Validate input: exactly the puzzle's `plies` moves (422 otherwise), each matching `^[a-h][1-8][a-h][1-8][qrbn]?$`. Replay through `chessrules`; an illegal or malformed move gives 422 with its 1-based `ply`. A rejected guess doesn't use one of the six.
5. Compute feedback (§8.3). Solved if the replayed target key equals the target.
6. Insert the guess. If solved, or failed on guess 6, set the status and `finished_at`, then recompute `player_stats` (archive attempts count in no stats, streaks or leaderboards; DECISIONS 2026-10-23).
7. Return feedback and status, plus the solution only if the attempt just finished.

### 10.6 Authentication

- **Passwords:** argon2id, at least OWASP's minimum parameters (m = 19 MiB, t = 2, p = 1; stronger is fine), stored as a PHC string with its parameters. Password length 8–128.
- **Sessions:** 32 random bytes, base64url in the cookie `rg_session` (HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE`, Path=/), sha256 stored in the DB. 30-day sliding expiry. Rotate the token on login, register and logout.
- **CSRF:** SameSite=Lax cookies, and every state-changing request must have `Content-Type: application/json` and an `Origin` header equal to `BASE_URL` (reject otherwise). The OAuth callback is protected by `state`.
- **Guest merge:** in one transaction, for each guest attempt whose puzzle the user hasn't played, re-point it to the user's player; delete the rest and the guest player; recompute that user's `player_stats` from attempts.
- **Sign in with Lichess (OAuth 2.0 authorization code + PKCE, no client secret).** Confirm every detail against the Lichess API docs and the `lichess-org/api-demo` repo before implementing.
  1. `/auth/lichess/start`: create random `state` and `code_verifier`, `code_challenge = base64url(sha256(verifier))`. Store hash(state) → verifier, current guest player and a validated relative `return_to`, with a 10-minute expiry. Redirect to `LICHESS_BASE_URL/oauth` with `response_type=code`, `client_id`, `redirect_uri=BASE_URL/api/auth/lichess/callback`, `code_challenge_method=S256`, `code_challenge`, `state`. Request no scopes; identity only.
  2. Callback: look up and delete the state row (reject if missing or expired); POST `LICHESS_BASE_URL/api/token` with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`.
  3. GET `/api/account` with the bearer token to read the Lichess `id` and `username`.
  4. Revoke the token right away (DELETE `/api/token`). We never store Lichess tokens.
  5. Find the user by `lichess_user_id` or create one. Use the Lichess username if free, else append a numeric suffix. Merge the guest, create the session, redirect to `return_to`.
- **Rate limits** (in-memory token buckets, injected, not global): login/register 10 per minute per IP and per username; guesses and hints 30 per minute per player; `POST /daily/{number}/start` 300 per hour per IP (generous, because many users share an IP); OAuth start 10 per minute per IP. The client IP comes from `X-Forwarded-For` only when the request arrives from an address in `TRUSTED_PROXIES` (§10.2).

### 10.7 Leaderboards

Daily: solved attempts for the puzzle with `is_archive = false`, ordered per §8.5, top N plus the caller's rank (window function). All-time: from `player_stats` joined to users (guests excluded).

### 10.8 Observability

`slog` JSON logs with request id, method, path, status, duration. No PII beyond username. `/api/health` pings the DB with a short timeout.

---

## 11. Quality

### 11.1 Security checklist

Argon2id passwords; hashed session tokens; secure cookie flags; origin check on state-changing requests; parameterized SQL only (sqlc); strict input validation and request body size limit (e.g. 16 KiB); security headers (CSP with `default-src 'self'` plus what Vite output and Comlink workers need, including `img-src 'self' data:` because the board's piece images are inline SVG data URIs; the theme bootstrap is an external script, so no `'unsafe-inline'` is needed, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`); rate limits; no secrets in logs; solution never sent before an attempt finishes (tested); `return_to` accepts relative paths only (no open redirect).

### 11.2 Testing strategy

| Package | Tests |
|---|---|
| engine | Unit + property (fast-check) + perft + brute-force cross-checks; coverage ≥ 90% statements |
| generator | Determinism test (same seed ⇒ byte-identical output), `verify` on a committed 20-puzzle fixture |
| api | Unit tests for feedback, hints, streaks and day boundaries (fake clock); integration tests against real Postgres for every endpoint, including auth, merge, concurrency (two simultaneous guesses on one attempt) and the no-solution-leak test; coverage ≥ 75% |
| cross-language | `fixtures/replay-vectors.json`: ≥ 500 random legal games (with castling, en passant, promotions, underpromotions) plus ≥ 100 games with one illegal move injected, each with expected `finalKey` or `illegalAt`. Generated by the engine (`pnpm --filter @retrograde/engine fixtures`), checked by a Go test. `fixtures/feedback-vectors.json` from §8.3. |
| web | Component tests (feedback row, move input, share text builder, Lab report rendering); Playwright e2e for the journeys in §1.4, using a seeded test puzzle with a known solution |

### 11.3 CI (GitHub Actions)

On every push and PR, on Ubuntu: install with caches; lint, typecheck and fast tests for all TS packages; `go vet`, golangci-lint and `go test` with a Postgres service container; check that generated code is up to date (`pnpm gen` produces no diff); build the web app and (from Phase 9, when the `Dockerfile` exists) the Docker image. Go module and build caches are cached between runs. A second job on `windows-latest` runs `pnpm install`, the TS fast tests and the Go unit tests, so the scripts stay Windows-compatible. Run slow tests on a nightly schedule.

### 11.4 Accessibility and performance

- Lighthouse accessibility ≥ 95 on `/daily` and `/lab`; full keyboard play possible (type SAN or UCI into a move input as an alternative to dragging).
- Main-thread JS bundle aim: ≤ 250 KB gzipped (the worker is loaded separately). Record actual sizes in `PROGRESS.md`.
- Visual direction: a "detective's casebook": warm paper tones in light mode, deep ink in dark mode, a serif display face for headings, a clean sans for UI, monospace for notation. Self-host fonts via `@fontsource` (OFL). Choose a board piece set whose license is GPL-compatible and record it in `DECISIONS.md`.

### 11.5 Deployment

Multi-stage `Dockerfile`: build web (Node) → copy `apps/web/dist` into `services/api/internal/webui/dist` → build Go binary embedding it → minimal runtime image running as non-root. `retrograde migrate` runs on start (or as a release step). Document one complete deployment path (for example Fly.io or Render with managed Postgres, or a small VPS with Docker Compose) in `docs/DEPLOY.md`, including how to import puzzles and schedule a year of dailies.

### 11.6 README (this project is a portfolio piece)

Live demo link, a GIF of solving a daily and of the Lab, a one-paragraph pitch, an architecture diagram, an **"Interesting problems"** section (retraction completeness, admissible bounds and the castling trap, memoized uniqueness counting, matching-based capture accounting, keeping chess rules consistent across Go and TS), how to run locally, test commands, license.

---

## 12. Phases and acceptance criteria

Each phase ends with the routine in `CLAUDE.md`: checks green, `PROGRESS.md`, `docs/learning/phase-N.md`, commit, tag `phase-N`, stop.

### Phase 0: Foundations
Refs: §3 (especially §3.5), §11.3. Deliverables: pnpm workspace with the three TS packages (engine as an empty library with one passing test), Go module with `serve` and `GET /api/health`, `api/openapi.yaml` with the health endpoint, codegen wired (`pnpm gen`), docker-compose Postgres, goose with an initial empty migration, the root scripts listed in `CLAUDE.md` (cross-platform, with the `prepare` hook setup), `.gitignore` (including `.env`, `node_modules`, build output, `.claude/settings.local.json`), ESLint/Prettier/golangci-lint configs, CI workflow, `LICENSE` (GPL-3.0-or-later), `.env.example`, `.nvmrc`, README skeleton, `docs/PROGRESS.md` and `docs/DECISIONS.md` filled in. Before installing anything, check which tools exist on the machine (`node -v`, `pnpm -v`, `go version`, `docker version`, `psql --version`) and report what's missing with Windows install instructions.
- [ ] On the owner's Windows machine, with the local PostgreSQL: `pnpm install`, `pnpm db:migrate` and `pnpm check` pass on a clean clone. The same commands pass in CI on Ubuntu.
- [ ] `pnpm dev` serves a placeholder web page that calls `/api/health` through the Vite proxy and shows "API: ok".
- [ ] `pnpm gen` regenerates code with no diff.
- [ ] `git config core.hooksPath` prints `.githooks` after `pnpm install`, and a test commit containing a Claude `Co-Authored-By` trailer is stored without it.
- [ ] CI runs green on GitHub (Ubuntu and Windows jobs).

### Phase 1: Engine core
Refs: §4. 
- [ ] All perft rows pass at the fast-suite depths; slow suite passes depth 5 and start position depth 6.
- [ ] Property tests for FEN, make/unmake, Zobrist and SAN/UCI round-trips pass.
- [ ] `replay` handles every special move.
- [ ] Perft nodes/second recorded in `PROGRESS.md`.

### Phase 2: Retro analysis
Refs: §5.
- [ ] Every rule in §5.2 implemented, each with trigger and non-trigger tests.
- [ ] Retraction completeness and soundness property tests pass (2,000 fast / 50,000 slow).
- [ ] ≥ 30 curated fixtures with the expected verdicts, including the §5.5 table.
- [ ] `lastMoves` with depth and limits; `LAST_MOVE_FORCED` and `NO_POSSIBLE_LAST_MOVE` tested.
- [ ] `pnpm --filter @retrograde/engine fixtures` writes `fixtures/replay-vectors.json` per §11.2.

### Phase 3: Proof-game solver
Refs: §6.
- [ ] Admissibility property test passes over ≥ 5,000 random games (fast) / 100,000 (slow), including castling, promotion and en passant games.
- [ ] Brute-force cross-check matches for N ≤ 4 (fast) and N = 5 (slow).
- [ ] Every random-game target up to N = 10 in the test sample is solved with status `complete`.
- [ ] `bench` results recorded; median at N = 8 within the §6.5 target.
- [ ] `analyzePosition` returns `legal` with a proof for the §5.5 legal fixture.

### Phase 4: Puzzle generator
Refs: §7.
- [ ] `generate`, `verify`, `stats` commands work; output is deterministic for a seed (test).
- [ ] Every emitted puzzle passes `verify` (re-solved unique and shortest).
- [ ] A pool of ≥ 500 puzzles covering all 5 difficulty levels with the weekly-ramp cut points (§7.3), enough for 365 days of the ramp (≥ 53 each of ★, ★★★★, ★★★★★ and ≥ 105 each of ★★, ★★★), committed to `data/puzzles-v1.jsonl` (or regenerable by a documented command if large). Report the distribution.

### Phase 5: Web shell and Lab
Refs: §9, §11.4. Deliverables: routing and layout for every route (`/`, `/daily`, `/daily/:number`, `/archive`, `/lab`, `/leaderboard`, `/u/:username`, `/login`, `/register`, `/about`, 404), visual design system, `Board` wrapper, worker client, the complete Lab, and an `/about` page explaining retrograde analysis with interactive examples. Pages that need the API show tasteful placeholders until Phase 7.
- [ ] Lab: edit, paste FEN, auto-analysis, detective notes with highlights, last moves with take-back, Prove with progress and Cancel, permalinks, example gallery.
- [ ] Works at 360px; keyboard accessible; component tests for the report and notes.
- [ ] Playwright: open the Lab with an illegal example, see the verdict and reason.

### Phase 6: API core
Refs: §8, §10, §11.1.
- [ ] Migrations for §10.3; `import-puzzles` (idempotent) and `schedule` subcommands.
- [ ] Endpoints in §10.4 except Lichess, matching `openapi.yaml`.
- [ ] Guests, register, login, logout, guest merge, session rotation.
- [ ] Guess submission per §10.5 with feedback vectors passing; hints; streaks and stats; daily and all-time leaderboards.
- [ ] Integration tests for every endpoint, including the no-solution-leak test and concurrent guess submission.
- [ ] Go replay matches `fixtures/replay-vectors.json`.
- [ ] `pnpm seed` imports the fixture puzzles and schedules them starting today for local dev.

### Phase 7: Daily UI, leaderboards, profiles, archive
Refs: §8, §10.4.
- [ ] Daily play end to end: board input, ply counter, difference overlay, submit, feedback rows with icons and `aria-live`, hints, win/lose screens, solution playback, share card exactly per §8.6.
- [ ] Register/login pages; header shows guest vs user; guest progress survives signing up.
- [ ] Leaderboards, profile with guess distribution, archive list and archive play.
- [ ] Playwright: a guest solves the seeded daily using the known solution; a user registers and keeps the result; the leaderboard shows them.

### Phase 8: Sign in with Lichess
Refs: §10.6.
- [ ] Full PKCE flow against a fake Lichess server in tests (state mismatch, expired state, token error and username collision cases covered).
- [ ] Manual check against real lichess.org in development, documented in `PROGRESS.md`.
- [ ] Tokens revoked after use and never stored or logged.

### Phase 9: Polish and ship
Refs: §11.
- [ ] Production Docker image; `docs/DEPLOY.md`; the app deployed and reachable (the human provides hosting credentials; Claude prepares everything else).
- [ ] Lighthouse accessibility ≥ 95 on `/daily` and `/lab`; bundle sizes recorded.
- [ ] README per §11.6 with screenshots or GIFs (the human may record them; leave clear placeholders).
- [ ] Security checklist §11.1 reviewed line by line, with results in `PROGRESS.md`.
- [ ] `docs/RUNNING.md`: how to run everything locally on Windows from a fresh clone (install, `.env`, migrate, seed, `pnpm dev`, `pnpm start`), every test command, and a **manual test checklist** covering each journey in §1.4 plus the Lab examples, archive, leaderboards, profile, Lichess login and share card. Each item says what to click and what you should see.
- [ ] Final full run on the owner's machine: from a fresh clone, every command in `RUNNING.md` succeeds, and the whole automated suite passes (`pnpm check`, slow engine tests, `pnpm test:api`, `pnpm test:e2e`). Results recorded in `PROGRESS.md`.

---

## 13. Out of scope for v1 (ideas for later)

Case Files story campaign with Holmes-style narration; composer mode with the uniqueness checker; head-to-head races; partial retrograde analysis puzzles; fairy-chess proof games; puzzle ratings with Glicko-2 from solve results; porting the solver to Go or Rust/WASM to compare performance; stretch rules from §5.6.

---

## 14. References

- Retrograde analysis and proof games: Wikipedia articles "Retrograde analysis" and "Proof game"; The Retrograde Analysis Corner (janko.at/Retros); Elkies & Stanley, *Chess and Mathematics* (proof game section).
- Existing solvers, for ideas only: Natch, Euclide, Jacobi (wismuth.com/jacobi), Popeye (github.com/thomas-maeder/popeye). Don't copy their code; respect their licenses.
- Chess programming: chessprogramming.org (0x88, Perft Results, Zobrist hashing, Move Generation).
- Lichess API docs (OAuth PKCE, `/api/account`), `lichess-org/api-demo`.
- chessground (github.com/lichess-org/chessground).
