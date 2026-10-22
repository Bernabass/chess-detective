# Phase 1: Engine core

Phase 1 builds the chess rules: a board, moves, FEN, notation and hashing. Everything later (retro analysis, the proof-game solver, the puzzle generator, the board in the browser) sits on top of this. The bar is **provably correct first, then fast**. Correctness is proved by *perft*, speed is measured by a benchmark, and properties are checked on thousands of random positions.

All code is in [packages/engine/src/core/](../../packages/engine/src/core/), exported only through [src/index.ts](../../packages/engine/src/index.ts).

## 1. The 0x88 board

[board.ts](../../packages/engine/src/core/board.ts)

The board is an `Int8Array(128)`, not 64. Square = `rank * 16 + file`, so each rank has 8 real squares followed by 8 padding squares:

```
rank 8: 112..119 | 120..127 (padding)
...
rank 1:   0..7   |   8..15  (padding)
```

The trick: in binary, a real square never has bit 3 (file ≥ 8) or bit 7 (rank ≥ 8 or negative) set. So **`sq & 0x88` is non-zero exactly when a square is off the board**. Moving a knight is `to = from + 33`, and one AND tells you whether it fell off any edge. No `if (file < 0 || file > 7 …)` chains, no wrap-around bugs (on a plain 0..63 board, h1 + 1 = a2).

Pieces are small integers: 1..6 = P N B R Q K for White, negative for Black, 0 for empty. "Is this an enemy?" becomes a sign test: `board[sq] * sign < 0`.

## 2. Moves as integers

[move.ts](../../packages/engine/src/core/move.ts)

A move is one 32-bit integer: from (7 bits), to (7 bits), promotion piece (3 bits), and flag bits for capture, double push, en passant, castle and promotion. Search code handles millions of moves per second, and numbers cost nothing to create or compare, while objects would mean garbage collection. Conversion to `"e2e4"` or `"Nf3"` happens only at the edges ([uci.ts](../../packages/engine/src/core/uci.ts), [san.ts](../../packages/engine/src/core/san.ts)).

## 3. Make, unmake and the undo stack

[makemove.ts](../../packages/engine/src/core/makemove.ts)

`makeMove` changes the position **in place**; `unmakeMove` restores it exactly. What can't be recomputed from the move itself (the captured piece, castling rights, en passant square, halfmove clock, hash, king squares) is pushed onto an `Int32Array` undo stack, 8 ints per move. Search never copies a position: walk down with `makeMove`, walk back up with `unmakeMove`.

Details worth knowing:
- **Castling rights** are updated with a mask: `castling &= MASK[from] & MASK[to]`. Moving the king off e1 clears both white rights; anything moving from *or to* h1 clears White's kingside right, which also covers "the rook was captured at home".
- **En passant** captures a pawn that isn't on the destination square (it's one rank behind), so the capture square is computed separately.
- The property test checks that make+unmake restores **every field** after every legal move in every position of 20 random games.

## 4. Move generation and legality

[movegen.ts](../../packages/engine/src/core/movegen.ts), [attacks.ts](../../packages/engine/src/core/attacks.ts)

Two stages, as in most engines:
1. **Pseudo-legal moves:** every move the pieces could make, ignoring whether it leaves your own king in check.
2. **Legality filter:** keep only the moves that don't leave your king attacked.

`isAttacked(board, sq, by)` works *outward from the target square*: check the two pawn squares, the 8 knight squares, the 8 king squares, then walk the 8 rays until the first piece. If that piece is a rook or queen (straight rays) or a bishop or queen (diagonals), the square is attacked.

**The legality shortcut** (it took perft from about 2.5M to 4M nodes/s): making and unmaking every move just to test it is expensive. But if you're not in check, a move that isn't a king move or en passant can only be illegal if the moving piece is **pinned**, and a pinned piece must be on a line (rank, file or diagonal) with its own king. A precomputed table answers "are these two squares on a line?" with one lookup, and most moves skip the expensive test.

**Special moves that trip people up**, each with its own test in [movegen.test.ts](../../packages/engine/test/movegen.test.ts):
- **Castling** needs the right, the king and rook on their home squares, an empty path, and the king not in check and not passing through or landing on an attacked square. The b1 square must be empty for queenside castling but may be attacked (the king doesn't cross it).
- **En passant and the horizontal pin:** in `7k/8/8/KPp4r/8/8/8/8 w - c6`, bxc6 e.p. removes *two* pawns from the 5th rank at once, exposing the king on a5 to the rook on h5. A pin check that only looks at the moving piece misses this, which is why en passant always gets the full make/test/unmake.
- **Never trust the FEN alone:** castling rights or an en passant square from a FEN are only used if the board agrees (king and rook really at home, a pawn really behind the en passant square). Illegal-but-parseable positions (no king, two kings, 64 queens) must never crash the generator, since the Lab will feed them in.

## 5. Perft: how we know it's right

[perft.ts](../../packages/engine/src/core/perft.ts), [perft.test.ts](../../packages/engine/test/perft.test.ts)

`perft(position, depth)` counts every legal move sequence of exactly `depth` plies. The counts for well-known positions are published (chessprogramming.org "Perft Results") and agreed on by every serious engine. For example, the start position has 20 moves, 400 two-ply sequences, and **119,060,324** at depth 6. One wrong rule (a missing en passant case, castling through check) changes the count, so matching all six reference positions to depth 5 is very strong evidence the move generator is exactly right.

Positions 2–6 are chosen to be nasty: Kiwipete is packed with castling, pins and en passant; Position 3 has the en passant discovered-check case; Position 4 has promotions and checks.

Debugging tip, if a count is ever wrong: compare the per-move counts at depth 1 against a known-good engine, and descend into the move whose subtree count differs.

## 6. Zobrist hashing

[zobrist.ts](../../packages/engine/src/core/zobrist.ts)

A position's hash is the XOR of random 64-bit keys, one per feature: (piece, square) pairs, "Black to move", the castling-rights value, and the en passant file. XOR is its own inverse, so a move updates the hash by XOR-ing out the old features and XOR-ing in the new ones: a handful of operations instead of rescanning the board. The solver (Phase 3) will use the hash as a transposition-table key.

- **Two 32-bit halves** instead of one 64-bit number: JavaScript bit operations work on 32 bits, and BigInt is slow.
- **Fixed seed:** the keys come from our own [splitmix32 RNG](../../packages/engine/src/util/rng.ts), so every machine computes the same hashes. A test pins the start-position hash.
- **En passant only when usable:** the en passant file is hashed only if a pawn of the side to move could actually capture (as Stockfish does). After 1.e4 no black pawn can take on e3, so "1.e4 with ep e3" and "the same position with `-`" hash the same. They really are the same position for every future move.
- The property test recomputes the hash from scratch after every move and checks it equals the incremental one.

## 7. FEN and notation

- [fen.ts](../../packages/engine/src/core/fen.ts): `parseFen` checks **syntax only** and reports every broken field at once. Legality ("two white kings") is the analyzer's job in Phase 2. `toFen` writes canonical FEN, so `toFen(parseFen(x))` is a normal form.
- [san.ts](../../packages/engine/src/core/san.ts): `moveToSan` adds disambiguation only when needed (file first, then rank, then both, e.g. `Qa1b2`) and `+`/`#` by making the move and checking for check and for any legal reply. `sanToMove` is lenient (`0-0`, `e8=q`, missing `+`) but strict where it matters: `d5` is never read as the capture `exd5`, and ambiguous moves are rejected with the options listed.

## Questions an interviewer might ask

1. **"Why 0x88 instead of bitboards?"** Bitboards (one 64-bit integer per piece type) are faster in C++, but JavaScript has no fast 64-bit integers. 0x88 gives one-instruction edge detection with plain small integers and is easy to reason about. For a puzzle solver, ~4M nodes/s is plenty.
2. **"How do you know your move generator is correct?"** Perft against published counts for six positions designed to hit every special case, to depth 5 (and depth 6 for the start position). Plus property tests: make+unmake restores everything, incremental hash equals recomputed hash, and FEN/SAN/UCI round-trip on thousands of random positions.
3. **"What is a Zobrist hash, and what's a collision?"** XOR of random keys per position feature, updated incrementally. Two different positions can share a hash (the chance per pair is about 2⁻⁶⁴), so the Phase 3 transposition table stores the full key to verify entries.
4. **"Explain the en passant horizontal pin."** The capture removes two pawns from the same rank at once, which can open a line between the king and an enemy rook. Checking whether only the moving pawn is pinned misses it, so en passant always gets a full make, test and unmake.
