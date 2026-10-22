# Phase 2: Retro analysis

Phase 1 taught the engine to play chess forwards. Phase 2 teaches it to think **backwards**, like a detective: given a position, what must have happened before it? The answers feed the Lab's verdict ("Illegal", "Undecided"), its "detective notes", and its list of possible last moves.

Code: [packages/engine/src/retro/](../../packages/engine/src/retro/). Public entry points: `staticFindings`, `retractions`, `lastMoves`, `analyzePosition` in [src/index.ts](../../packages/engine/src/index.ts).

## 1. The ground rule: soundness

The analyzer says **illegal** only when the contradiction is certain, and **legal** only with a proof game. Everything else is **undecided**. A false "illegal" is the worst possible bug for a puzzle site, so every design choice below protects that guarantee, even at the cost of missing some illegal positions.

## 2. Static rules: contradictions you can see at a glance

[rules.ts](../../packages/engine/src/retro/rules.ts). Each rule looks only at the current position. Examples:

- **Counting:** two kings, 17 pieces, 9 pawns, a pawn on the back rank.
- **Promotions:** two queens plus eight pawns means at least one queen is a promoted pawn, so that's nine pawns, one too many (`PROMOTION_EXCESS`). Bishops count by square colour: two dark-squared bishops also need a promotion.
- **Checks:** if it's White's move but the black king is in check, Black's last move left its own king in check (`OPPONENT_IN_CHECK`). One move can create at most a double check (`TOO_MANY_CHECKERS`).
- **Claims in the FEN:** castling rights claim that king and rook never moved; an en passant square claims a double push just happened. Each claim must match the board.

Some rules produce **deductions** instead: true facts about the past, like "White's pawns made at least 2 captures" or "White can no longer castle kingside".

## 3. Pawn capture accounting: a matching problem

[pawns.ts](../../packages/engine/src/retro/pawns.ts). A pawn changes file only by capturing, one file per capture, and it can't change files faster than it advances: a white pawn on rank 4 has moved 2 ranks, so it started within 2 files of where it stands. Every pawn began on its own file, so we're **assigning pawns to starting files**, each file used at most once.

- The cost of assigning a pawn to a starting file is the file distance, i.e. the number of captures that path needs.
- The **cheapest assignment** is the fewest captures those pawns can have made. If that exceeds the number of enemy pieces missing, the position is illegal.

### The bitmask dynamic program

With at most 8 pawns and 8 files, we can try assignments cleverly instead of all 8! orders:

- Keep `best[mask]`, where `mask` is an 8-bit set of *used* files. `best[mask]` = cheapest way to give the **first `popcount(mask)` pawns** exactly the files in `mask`.
- Start: `best[0] = 0`.
- Step: from any reachable `mask`, the next pawn is number `i = popcount(mask)`. Try each free file `f` it's allowed to come from: `best[mask | 1<<f] = min(..., best[mask] + |file(pawn i) − f|)`.
- Answer: the cheapest `mask` with `popcount = number of pawns`.

That's at most 256 states × 8 files = 2,048 steps: instant, and exact. Recording which file each step chose lets us walk back and highlight the pawns that must have captured.

*Why it works:* the order in which pawns pick files doesn't matter for the total cost, so we can fix it (pawn 0, then pawn 1, ...). Then the only thing the future cares about is **which files are already used**: that's the mask.

### When there's no assignment at all: Hall's theorem

Take white pawns on a2, b2, a3 and b3. The a2 pawn can only have started on a (it hasn't moved), and b2 only on b. The a3 pawn has moved one rank, so it started on a or b, but both are taken. There's no valid assignment, so the position is illegal (`PAWN_STRUCTURE_IMPOSSIBLE`).

**Hall's marriage theorem** says exactly when an assignment exists: for **every group S of pawns, the set N(S) of files they could have come from has at least |S| files**. Here S = {a2, b2, a3} has N(S) = {a, b}: 3 pawns, 2 files. The theorem also tells us how to *find* such a group, which makes the explanation concrete:

1. Run a **maximum matching** (augmenting paths): give each pawn in turn a file, re-routing earlier pawns along "alternating paths" when needed.
2. If some pawn X can't be matched, collect everything reachable from X by alternating paths: X's possible files, the pawns currently holding those files, *their* possible files, and so on.
3. Every file reached is held by a reached pawn (otherwise we'd have found a free file and matched X). So the reached pawns S have exactly **|S| − 1** files between them: a Hall violation, the blocking group.

The message names both: "3 white pawns (a2, b2, a3) could only have started on the a- and b-files, so the pawn on a3 has no possible starting file." All three pawns are highlighted, because the problem is the *group*, not one pawn. Pawns are matched least-advanced first, so the pawn named is the most "suspicious" one.

## 4. Retractions: playing chess backwards

[retract.ts](../../packages/engine/src/retro/retract.ts). A **retraction** of Q is a prior position P′ plus a move m such that playing m in P′ gives Q. The **retractor** is the side that just moved. We generate candidates from geometry:

| Kind | Idea |
|---|---|
| normal | Move a piece backwards to an empty square (pawns: straight back, or two from their 4th rank) |
| uncapture | The same, and an enemy piece reappears on the square the piece left |
| unpromotion | A queen, rook, bishop or knight on the last rank turns back into a pawn |
| un-en-passant | A pawn on its 6th rank steps back diagonally; the captured enemy pawn reappears beside it |
| uncastle | King g1 + rook f1 go back to e1 + h1 (and the queenside version) |

Then every candidate is **confirmed by forward generation**: in P′, the normal move generator must produce the move, it must not leave the mover's king in check, and playing it must give exactly Q. That's what makes every retraction *sound by construction*: whatever the geometry code gets wrong, a bogus candidate can't survive.

### Claims, and what "-" means

A FEN's castling and en passant fields are **claims about history**, and `-` claims **nothing**:
- Q states an en passant square → the last move *must* be that double push.
- Q states castling rights → king and rook *never moved*, so the last move can't have been theirs.
- Q writes `-` → no constraint. Many FENs write `-` right after 1.e4, so …e7-e5 must stay possible.

These two rules make the analyzer stronger without hurting soundness. For example, `r3k2r/8/8/8/8/8/8/R3K2R b KQkq` is illegal: White just moved, but the stated rights freeze White's only pieces.

### Proving completeness: the previous position isn't fully knowable

The completeness test plays a random move m from P to Q and demands that `retractions(Q)` contain a retraction back to P. But a retraction can't know everything about P:

| Field | Knowable? | Test compares |
|---|---|---|
| placement, side to move | yes | equal |
| castling rights | only those that survived into Q (plus the one castling used) | retracted ⊆ true |
| en passant square | only if m was an en passant capture | equal in that case, otherwise the retracted one is empty |
| clocks | no | ignored |

So "P′ matches P" means **P′ is P with only the unknowable details left out**. The test also checks Q with `-` for en passant and castling, and checks soundness separately with the full move generator.

## 5. Last moves and viability: thinking several moves back

[lastmoves.ts](../../packages/engine/src/retro/lastmoves.ts). A retraction might look fine one move back and still be impossible further back. **Viability at depth k**:
- P′ passes every static rule, and
- k = 1, or P′ is the initial position, or P′ has a retraction viable at depth k − 1.

This is a depth-limited search backwards in time. Three results: **viable**, **not viable**, or **unknown** (a time, node or stop limit cut it short). Claims are made only from definite results:

- `NO_POSSIBLE_LAST_MOVE`: no retraction passes even at depth 1.
- `NO_POSSIBLE_HISTORY`: every last move leads to a dead end within the depth. Example: in `r3k2r/pppp1ppp/4p3/8/8/8/PPPPPPPP/R3K2R w KQkq`, Black's only last move is …e7-e6. Before that, White must have moved, but KQ freezes White's king and rooks and every white pawn is at home. That's depth 2.
- `LAST_MOVE_FORCED`: exactly one distinct move survives and everything else is definitely ruled out ("…Kh8-g8, possibly capturing a white knight, bishop, rook or queen").

Results are cached by an **exact** key (placement, side, castling, en passant) rather than the Zobrist hash, so a hash collision can never fake an "illegal".

### Why the knight-parity start position is still "undecided"

`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq` (the start position, Black to move) is actually illegal. With every pawn at home, the only pieces that can move are the knights, plus a rook stepping into a knight's vacated square and back. Any such trip that ends back home takes an even number of moves (a knight changes square colour on every move; a rook just shuttles), so White can never be exactly one move ahead. Retractions can't see this, because there's always another knight move to take back. That needs a parity argument (stretch rule `PARITY`). It's a nice example of why "undecided" is an honest answer.

## 6. Making it fast enough to test thoroughly

The completeness test retracts every legal move from 2,000 random positions (about 70,000 positions Q) in three forms each. Profiling drove three changes:
1. **Scratch position:** apply a candidate's few square changes, test, revert. No allocation for rejected candidates.
2. **One make per candidate:** find the move among the piece's pseudo-legal moves, make it once, check legality and the result together.
3. **Lazy priors:** each retraction builds its full prior position only when someone reads it. Most callers read few.

Together, about 5× faster. The test files are also split so Vitest runs them in parallel.

## Questions an interviewer might ask

1. **"How do you avoid claiming a legal position is illegal?"** Only certain contradictions count as illegal. Retractions are confirmed by forward generation. Claims come only from fully searched results (unknown never becomes "not viable"). The cache uses exact keys, not hashes. Property tests check completeness (no possible last move is ever missed) and soundness (every reported one is real).
2. **"Explain the pawn assignment algorithm and its complexity."** Min-cost assignment of ≤ 8 pawns to 8 files. The bitmask DP has 2⁸ states × 8 transitions, exact and tiny. A Hungarian algorithm would also work (O(n³)), but at n = 8 the DP is simpler to get right.
3. **"What does Hall's theorem give you here?"** The exact condition for an assignment to exist, and a certificate when it doesn't: a group of k pawns with only k − 1 possible files. That certificate *is* the explanation shown to the user.
4. **"Why can't a retraction know the previous en passant square or castling rights?"** Those depend on moves before the last one, which leave no trace on the board. The design treats them as unknown (and FEN fields as optional claims) instead of guessing, which is what keeps it sound.
