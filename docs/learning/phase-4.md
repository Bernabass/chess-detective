# Phase 4: Puzzle generator

The daily puzzle is a **proof game**: reach a target position from the start in exactly N plies, where exactly one N-ply game does it and no shorter game does. Phase 4 builds the program that finds hundreds of such targets, checks each one with the solver, tags what makes it interesting, and rates its difficulty.

Code: [apps/generator/src/](../../apps/generator/src/). Command line: `pnpm --filter @retrograde/generator start -- generate|verify|stats` ([main.ts](../../apps/generator/src/main.ts)).

## 1. Why random games don't work

The obvious generator plays a random game of N plies and asks the solver whether its final position has a unique shortest proof. Almost none do beyond about 8 plies: a random game has independent moves (a knight move on one wing and a pawn move on the other) that could have been played in the other order, and every such swap is a second solution. So random sampling throws away almost everything it tries at exactly the lengths we need most (the 4- and 5-star levels).

## 2. Growing puzzles: beam search on the prefix property

[beam.ts](../../apps/generator/src/beam.ts). The key fact:

> If a game of N + 1 plies is the **unique shortest** proof game for its final position, then its first N plies are the unique shortest proof game for the position after them.

Why: if the first N plies could be replaced by a different (or shorter) game reaching the same position, playing the last move after that game would give a different (or shorter) proof game for the final position too. One subtlety: this needs the *full* position (castling rights and en passant), because the last move's legality can depend on them. Our targets compare only placement and side to move, so the argument breaks only when the last move is castling or en passant. The beam still tries those moves, but it can miss a puzzle ending in one whose prefix isn't unique. The random source is there to catch those, though in practice it rarely does.

So every unique (N + 1)-ply puzzle extends a unique N-ply puzzle, and we can grow puzzles one ply at a time:

1. Start from the 1-ply games. For each accepted puzzle (the **frontier**), try every legal move as the next ply.
2. Verify each extension fully with the solver (section 4). The accepted ones become the next frontier.
3. Keep the frontier small and **diverse** (beam width W = 180): at most max(3, W / parents) children per parent; at most W/6, W/12, W/15 and 2 puzzles sharing their first 1, 2, 4 and 6 plies; a preference for captures, promotions, castling, en passant, checks and switchbacks; and no lines where a side's last three moves are quiet king moves (those are unique but dull).

Each diversity rule was learned the hard way. Without the 6-ply cap, every 12-ply puzzle descended from a few dozen 6-ply games, and the pool (which allows only 3 puzzles per 6-ply prefix) couldn't use them. And a fixed "3 children per parent" applied to the start position too, so a whole pool once grew from just 3 first moves. A beam keeps only the best W nodes, so whatever it discards early is gone for good: diversity has to be enforced at every depth, not hoped for.

This is a **beam search**: a breadth-first search that keeps only the best W nodes at each depth. The prefix property is what makes it complete enough. We never need to look at extensions of non-unique games, because none of them can be unique.

## 3. A free rejection: transposing the last move

[verify.ts](../../apps/generator/src/verify.ts) `hasTransposedLastMove`. Most extensions fail because the new move could have been played earlier. Before any search, we try exactly that: move the last move to each of the same side's earlier turns (that side's later moves each shift one turn on; the opponent's moves stay put), replay, and see if the game is still legal and reaches the same target. If so, there are two solutions and we are done in microseconds. It is **sound** (it only ever finds real second solutions) but not complete, so a candidate that passes still gets the full check. The beam also uses it to skip obvious transpositions *before* picking which children to verify.

## 4. Verifying a candidate: the check most likely to fail first

`verifyCandidate` runs, in this order:

1. **Unique:** count the N-ply games with cap 2. Exactly 1, with status `complete`. This runs first because it fails most often, and a count with cap 2 stops at the second solution.
2. **Shortest:** count the games at N − 2, N − 4, … down to the solver's lower bound from the start, with cap 1. All must be 0 and `complete`.

Every search has a **node limit** (200,000 by default), never a time limit. Whether a candidate passes then doesn't depend on the machine or on how busy it is, which is what makes the output reproducible. A candidate that hits the limit is discarded, never accepted.

The order matters because a proof of uniqueness is **exhaustive**: to know there's exactly one game, the solver must rule out every other. That's why accepted candidates cost far more than rejected ones, and why the time per candidate grows 2–4× per extra ply (about 0.1 s at 7 plies, 4 s at 12, in the committed pool's run).

## 5. Making the solver faster: the incremental bound

[bound.ts](../../packages/engine/src/solver/bound.ts) `createIncrementalBound`. Profiling a heavy 8-ply uniqueness count showed **half** the solver's time went into rebuilding the bound's piece lists by scanning all 64 squares, for every child of every node. But a move changes at most three lists: the mover's, a captured piece's, and a castling rook's.

So the search now keeps the lists up to date move by move:

- `push(p, m)` after `makeMove`: remove the piece from its old square's list, add it on the new square (as the promoted kind if it promoted), and remove a captured piece.
- `pop()` before `unmakeMove`: replay an **undo log** backwards to restore the lists *exactly*, in the same order.
- Each list has a **version number** that changes whenever the list does, and goes back to the old number on `pop`. The per-kind cost memo checks the version instead of comparing every square.

A property test follows thousands of random games with `push`, tries a side move at every third position (`push`, compare, `pop`), and checks that the incremental bound always equals one computed from scratch.

Two smaller changes help too: **frozen pawns** (a target pawn still on its start rank never moved, so no piece ever passes through its square, and a bishop shut in behind such pawns is correctly "unreachable"), and **reusing transposition tables** across the thousands of short solves instead of allocating megabytes each time (a generation counter makes `reset()` O(1)).

## 6. Parallel but deterministic

[workers.ts](../../apps/generator/src/workers.ts). Verification runs on `worker_threads` (`--jobs`). Candidates are sent in small chunks, so a slow candidate doesn't leave other workers idle. Results are put back **in input order**. Since each verdict depends only on the candidate and the node limit, the output is byte-identical whatever `--jobs` is, and a test checks exactly that (`--jobs 1` against `--jobs 2`). Every random choice uses a seed derived from `--seed` and the candidate itself, never `Math.random`.

## 7. Features, difficulty and stars

[features.ts](../../apps/generator/src/features.ts) replays the solution and **tracks each piece by identity**, so "the same piece came back" is real, not just "some piece is on that square again":

- **tempo:** a piece goes straight back (A→B→A);
- **switchback:** a piece returns to a square it left by another way;
- **phoenix:** a side promotes to a piece type it had lost (an original piece, not a promoted one);
- also capture, promotion, underpromotion, castling, en passant and king-walk.

[difficulty.ts](../../apps/generator/src/difficulty.ts) scores a puzzle (SPEC §7.3): plies, plus weights for captures, promotions, castling and so on, plus log₂(solver nodes)/4. The solver nodes are those of the uniqueness count: how much work it took to see there is exactly one game.

Stars come from the score's **rank in the pool**, not from fixed thresholds: the lowest 1/7 get ★, up to 3/7 ★★, up to 5/7 ★★★, up to 6/7 ★★★★, the top 1/7 ★★★★★. Those fractions match the weekly schedule (★ on 1 day, ★★ on 2, ★★★ on 2, ★★★★ on 1, ★★★★★ on 1), so the pool never runs out of one level first. Ties are broken by id, so the mapping is deterministic.

## 8. Choosing the pool

[pool.ts](../../apps/generator/src/pool.ts). From all accepted puzzles we pick the final 500 by **ply quotas** (15% at 5–6 plies, 28% at 7–8, 15% at 9, 28% at 10–11, 14% at 12), highest score first within each range, with **at most 3 puzzles sharing their first 6 plies** so the pool doesn't fill up with variations of one idea. The ranges are filled **longest first**: long puzzles are scarce and share their 6-ply prefixes with shorter ones, so they must claim the prefix allowance before the plentiful short puzzles use it up. Quota sizes use largest-remainder rounding so they add up to exactly the requested count.

## 9. An external check

The site wismuth.com publishes how many distinct positions ("diagrams", the 64 squares only) exist after exactly N plies, and how many of them are reached by exactly one N-ply game. With exactly N plies from the start, the side to move is fixed by parity, so a diagram per N is exactly our target key. Our brute force reproduces their numbers: 1, 20, 400, 5,362, 71,852 diagrams and 1, 20, 400, 1,862, 9,373 uniquely realizable ones for N = 0–4 (fast test), and 815,677 / 51,323 at N = 5 (slow test). Our puzzle definition adds "and no shorter game", so our counts are smaller: 1, 20, 400, 1,862 and 9,309. At N = 4, 64 positions have exactly one 4-ply game but are also reachable in 2 plies, like 1.a3 a6 2.a4 a5 (just 1.a4 a5). A generator test also checks `verifyCandidate` against this brute force on hundreds of 4-ply targets.

## Interview questions you should be able to answer

- *Why does the beam search find puzzles random sampling can't?* The prefix property: every unique shortest game extends a unique shortest game, so growing accepted puzzles explores only the part of the space where answers can exist.
- *When does the prefix property fail, and how do you cover it?* When the last move is castling or en passant, because the target ignores castling rights and en passant. The random source covers those.
- *Why node limits instead of time limits?* Determinism: a verdict that depends on wall time changes with machine load, so two runs with the same seed would disagree.
- *How do you keep parallel output deterministic?* Verdicts depend only on the input; seeds are derived per candidate; results are reassembled in input order.
- *Why is proving uniqueness expensive?* It's exhaustive: you must rule out every other game, while a rejection stops at the second solution found.
- *How do you make an incremental data structure safe?* An exact undo log, and a property test comparing it with a from-scratch computation through both push and pop.
