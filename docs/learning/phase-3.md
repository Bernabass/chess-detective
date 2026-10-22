# Phase 3: Proof-game solver

A **proof game** shows that a position can arise: a legal game from the start that reaches it in exactly N plies. Phase 3 builds the search that finds them, counts them (to prove a daily puzzle has exactly one solution), and lets the Lab say **"Legal"** with a proof instead of "Undecided".

Code: [packages/engine/src/solver/](../../packages/engine/src/solver/). Public entry points: `solveProofGame` and `shortestProofGame` in [src/index.ts](../../packages/engine/src/index.ts).

## 1. The problem and why brute force fails

From the start position there are 20 one-ply games, 400 two-ply games, 197,281 four-ply games, and over 100 million six-ply games. A 10-ply daily puzzle can't be brute-forced. What makes it tractable is **knowing when a branch is hopeless** and cutting it off early.

## 2. The search: depth-first with an exact budget

[search.ts](../../packages/engine/src/solver/search.ts). We search depth-first with the **exact** number of plies left, r. At r = 0 we compare the position with the target (placement + side to move).

**Per-side budgets** (§6.2): with r plies left and White to move, White has ⌈r/2⌉ moves and Black ⌊r/2⌋. A node is pruned if **either** side needs more moves than it has. Keeping the two budgets separate is much stronger than one shared budget: White being "ahead" can't cover for Black being behind.

## 3. The lower bound: an optimistic estimate that must never lie

[bound.ts](../../packages/engine/src/solver/bound.ts), [target.ts](../../packages/engine/src/solver/target.ts). For each side, h is the fewest moves it could possibly still need. It must be **admissible**: never more than the truth. If it ever overestimates, the search prunes a branch that contains a real solution, and the solver silently reports "no proof" or a wrong count.

h for a side is the larger of two lower bounds:

1. **Displacement.** Each target piece must be supplied by some current piece of the same kind, moved there. We use **empty-board distances**: on an empty board a piece is never slower than on a real one.
   - **King:** Chebyshev distance.
   - **Knight:** precomputed BFS table (a1 to h8 takes 6 moves).
   - **Bishop:** 0, 1 or 2 moves, or impossible if the target square is the other colour. That's why light- and dark-squared bishops are separate kinds.
   - **Rook and queen:** 0, 1 or 2 moves.
   - **Pawn:** every move advances one rank, except a double push from the start rank, which needs two straight ranks first. So e2→f5 is 2 moves (e4, exf5), not 3.

   Which current piece supplies which target piece is a **min-cost matching**.
2. **Captures.** If the opponent has 3 more pieces than in the target, this side must capture 3 times: at least 3 moves.

### The castling trap

Castling moves the king *and* a rook in one move. A naive bound counts e1→g1 as 2 king moves plus h1→f1 as 1 rook move: 3, when it really takes 1. That overestimate would hide every proof that castles. The fix: while a side may still castle, its king may count **1 + distance from its castled square**, and that rook **its distance from its castled square**, with its own move free. The castling move is then counted exactly once, through the king.

### The promotion hole (found while planning this phase)

The spec's original matching *forced* each current knight onto a target knight. Counterexample: White's only knight sits on a1, far from the target knight on g8, but a white pawn on g7 can promote to a knight on g8 in **one** move, and the old knight gets captured later (costing White nothing). True cost: 1. Forced matching: 4 or more. Overestimate.

The fix: any non-pawn target piece may instead be explained as **a promoted pawn at cost 0**, at most E = (current pawns − target pawns) times per kind. E is how many pawns can still disappear. The real limit is E in total across all kinds; allowing E *per kind* is looser, and looser is safe for a lower bound. The admissibility test deliberately creates this pattern (promote to a kind you already have, lose the original later) and asserts that it occurs.

### Making the bound fast

The bound runs at every node, so it's written to allocate nothing: typed arrays for piece lists, dedicated code for the common 1- and 2-piece cases, and a cache for the pawn matching (most moves don't move a pawn). One exact shortcut does most of the work: **a pawn already on a target pawn square is matched to it first**. That's safe by an exchange argument: if pawn A on target square tA were sent to tX while pawn B took tA, swapping to A→tA and B→tX never costs more, because B can reach tX *through* tA.

## 4. The transposition table: counting without recounting

Different move orders reach the same position: 1.Nf3 Nf6 2.Nc3 and 1.Nc3 Nf6 2.Nf3, for example. When **counting** solutions (for uniqueness), we store "from this position, with r plies left, there are k solutions" in a table keyed by the Zobrist hash plus r. The next time we arrive there, we look the count up instead of re-searching. That's **memoized counting**, and it turns repeated subtrees into a lookup.

- Counts **saturate at `cap`**. For uniqueness we only need to know 0, 1 or "2 or more", so the search stops a subtree as soon as it finds a second solution.
- In find modes the table only remembers **dead ends** (count 0). A find-all search must still walk any subtree that has solutions, to record them.
- Results of subtrees cut short by a time limit are **never stored**, since they'd be wrong.
- The table is fixed-size typed arrays, always-replace, storing the full 64-bit key. A test proves counts are identical with a tiny 16-entry table (constant replacement) and a big one.

## 5. Shortest proofs and the Lab's "Legal"

[shortest.ts](../../packages/engine/src/solver/shortest.ts). The side to move fixes the parity of N (White to move ⇒ even). The lower bound from the start position gives the first N worth trying. Then N, N + 2, … until a proof is found: the first one found is a **proven shortest proof**.

`analyzePosition` uses this as a quick proof attempt (10 plies, 750 ms by default) after the retro rules find no contradiction. If a proof is found, it is replayed as a self-check and the verdict is **legal**. The proof also has to keep the FEN's stated castling rights and en passant square, the same "claims" rule as Phase 2, so the solver prunes any branch that loses a required right. Otherwise the verdict stays **undecided**, never "illegal": no proof within 10 plies says nothing about longer games.

## 6. How we know it's right

- **Admissibility property:** 5,000 random games (100,000 in the slow suite). At every point of every game, h ≤ the moves that game actually used.
- **Brute-force cross-check:** enumerate every game of N ≤ 4 plies (N = 5 in the slow suite), group by final position, and compare the solver's counts. They match exactly.
- **Random targets:** every random game's final position is solved at its own length, up to N = 10.

On the benchmark, the median N = 8 target is solved in about 1–2 ms with a handful of nodes. With an admissible bound this tight, the search barely branches.

## Questions an interviewer might ask

1. **"What does 'admissible' mean, and what happens if the heuristic isn't?"** It never overestimates the remaining cost. If it does, pruning can discard real solutions, and a uniqueness check can then wrongly accept a puzzle with two solutions. That's why the property test is mandatory and runs on every check.
2. **"Why split the budget per side?"** Moves alternate strictly, so each side's moves are a separate resource. A combined budget would let White's slack hide Black's shortage.
3. **"How does the transposition table make counting cheap?"** The number of ways to finish from a position depends only on that position (including castling and en passant) and the plies left. So it can be cached and reused across move orders. Saturating at cap keeps uniqueness checks cheap.
4. **"How did you find the promotion bug?"** By questioning the spec's matching rule while planning, constructing a concrete position where it overestimates, then making the property test generate that pattern on purpose and assert it occurs.
