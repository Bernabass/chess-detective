import {
  A1,
  A8,
  BLACK,
  BLACK_KINGSIDE,
  BLACK_QUEENSIDE,
  C1,
  C8,
  D1,
  D8,
  E1,
  E8,
  F1,
  F8,
  G1,
  G8,
  H1,
  H8,
  KING,
  NO_SQUARE,
  PAWN,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
} from './board';
import { FLAG_CASTLE, FLAG_DOUBLE_PUSH, FLAG_EN_PASSANT, FLAG_PROMOTION, type Move } from './move';
import { UNDO_STRIDE, type Position } from './position';
import {
  CASTLE_HI,
  CASTLE_LO,
  EP_HI,
  EP_LO,
  PIECE_HI,
  PIECE_LO,
  SIDE_KEY,
  enPassantCapturable,
  pieceKey,
} from './zobrist';

/**
 * castling &= CASTLE_MASK[from]! & CASTLE_MASK[to]! drops the rights a move destroys: moving a
 * king or rook away from its home square, or capturing a rook on its home square.
 */
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[E1] = 15 & ~(WHITE_KINGSIDE | WHITE_QUEENSIDE);
CASTLE_MASK[H1] = 15 & ~WHITE_KINGSIDE;
CASTLE_MASK[A1] = 15 & ~WHITE_QUEENSIDE;
CASTLE_MASK[E8] = 15 & ~(BLACK_KINGSIDE | BLACK_QUEENSIDE);
CASTLE_MASK[H8] = 15 & ~BLACK_KINGSIDE;
CASTLE_MASK[A8] = 15 & ~BLACK_QUEENSIDE;

/** Rook from/to squares for a castling move, indexed by the king's destination square. */
const CASTLE_ROOK_FROM = new Int8Array(128);
const CASTLE_ROOK_TO = new Int8Array(128);
CASTLE_ROOK_FROM[G1] = H1;
CASTLE_ROOK_TO[G1] = F1;
CASTLE_ROOK_FROM[C1] = A1;
CASTLE_ROOK_TO[C1] = D1;
CASTLE_ROOK_FROM[G8] = H8;
CASTLE_ROOK_TO[G8] = F8;
CASTLE_ROOK_FROM[C8] = A8;
CASTLE_ROOK_TO[C8] = D8;

/**
 * Plays a move (assumed pseudo-legal for this position, as produced by the move generator)
 * and pushes what's needed to take it back onto the undo stack. Updates the hash incrementally.
 */
export function makeMove(p: Position, m: Move): void {
  const b = p.board;
  const us = p.turn;
  const them = us === WHITE ? BLACK : WHITE;
  const from = m & 0x7f;
  const to = (m >>> 7) & 0x7f;
  const piece = b[from]!;

  const base = p.ply * UNDO_STRIDE;
  if (base + UNDO_STRIDE > p.undo.length) {
    const bigger = new Int32Array(p.undo.length * 2);
    bigger.set(p.undo);
    p.undo = bigger;
  }
  const u = p.undo;
  u[base] = m;
  u[base + 2] = p.castling;
  u[base + 3] = p.epSquare;
  u[base + 4] = p.halfmove;
  u[base + 5] = p.hashHi;
  u[base + 6] = p.hashLo;
  u[base + 7] = (p.kingSquare[0]! + 1) | ((p.kingSquare[1]! + 1) << 8);

  let hi = p.hashHi;
  let lo = p.hashLo;
  if (enPassantCapturable(p)) {
    hi ^= EP_HI[p.epSquare & 7]!;
    lo ^= EP_LO[p.epSquare & 7]!;
  }
  hi ^= CASTLE_HI[p.castling]!;
  lo ^= CASTLE_LO[p.castling]!;

  // Remove the captured piece, if any.
  const captureSquare = (m & FLAG_EN_PASSANT) !== 0 ? (us === WHITE ? to - 16 : to + 16) : to;
  const captured = b[captureSquare]!;
  if (captured !== 0) {
    b[captureSquare] = 0;
    const k = pieceKey(captured, captureSquare);
    hi ^= PIECE_HI[k]!;
    lo ^= PIECE_LO[k]!;
    p.counts[captured + 6]!--;
    if ((captured === KING || captured === -KING) && p.kingSquare[them] === captureSquare) {
      p.kingSquare[them] = NO_SQUARE; // only in illegal positions
    }
  }
  u[base + 1] = captured;

  // Move the piece (promoting it if needed).
  let k = pieceKey(piece, from);
  hi ^= PIECE_HI[k]!;
  lo ^= PIECE_LO[k]!;
  b[from] = 0;
  let placed = piece;
  if ((m & FLAG_PROMOTION) !== 0) {
    const type = (m >>> 14) & 7;
    placed = us === WHITE ? type : -type;
    p.counts[piece + 6]!--;
    p.counts[placed + 6]!++;
  }
  b[to] = placed;
  k = pieceKey(placed, to);
  hi ^= PIECE_HI[k]!;
  lo ^= PIECE_LO[k]!;
  if (piece === KING || piece === -KING) p.kingSquare[us] = to;

  if ((m & FLAG_CASTLE) !== 0) {
    const rookFrom = CASTLE_ROOK_FROM[to]!;
    const rookTo = CASTLE_ROOK_TO[to]!;
    const rook = b[rookFrom]!;
    b[rookFrom] = 0;
    b[rookTo] = rook;
    k = pieceKey(rook, rookFrom);
    hi ^= PIECE_HI[k]!;
    lo ^= PIECE_LO[k]!;
    k = pieceKey(rook, rookTo);
    hi ^= PIECE_HI[k]!;
    lo ^= PIECE_LO[k]!;
  }

  p.castling &= CASTLE_MASK[from]! & CASTLE_MASK[to]!;
  p.epSquare = (m & FLAG_DOUBLE_PUSH) !== 0 ? (from + to) >> 1 : NO_SQUARE;
  p.halfmove = piece === PAWN || piece === -PAWN || captured !== 0 ? 0 : p.halfmove + 1;
  if (us === BLACK) p.fullmove++;
  p.turn = them;
  p.ply++;

  hi ^= SIDE_KEY[0]!;
  lo ^= SIDE_KEY[1]!;
  hi ^= CASTLE_HI[p.castling]!;
  lo ^= CASTLE_LO[p.castling]!;
  if (p.epSquare !== NO_SQUARE && enPassantCapturable(p)) {
    hi ^= EP_HI[p.epSquare & 7]!;
    lo ^= EP_LO[p.epSquare & 7]!;
  }
  p.hashHi = hi >>> 0;
  p.hashLo = lo >>> 0;
}

/** Takes back the last move made with makeMove, restoring the position exactly. */
export function unmakeMove(p: Position): void {
  if (p.ply === 0) throw new Error('unmakeMove: no move to take back');
  p.ply--;
  const base = p.ply * UNDO_STRIDE;
  const u = p.undo;
  const m = u[base]!;
  const captured = u[base + 1]!;
  const from = m & 0x7f;
  const to = (m >>> 7) & 0x7f;
  const b = p.board;
  const us = p.turn === WHITE ? BLACK : WHITE;
  p.turn = us;

  let piece = b[to]!;
  if ((m & FLAG_PROMOTION) !== 0) {
    p.counts[piece + 6]!--;
    piece = us === WHITE ? PAWN : -PAWN;
    p.counts[piece + 6]!++;
  }
  b[from] = piece;
  b[to] = 0;

  if (captured !== 0) {
    const captureSquare = (m & FLAG_EN_PASSANT) !== 0 ? (us === WHITE ? to - 16 : to + 16) : to;
    b[captureSquare] = captured;
    p.counts[captured + 6]!++;
  }

  if ((m & FLAG_CASTLE) !== 0) {
    const rookFrom = CASTLE_ROOK_FROM[to]!;
    const rookTo = CASTLE_ROOK_TO[to]!;
    b[rookFrom] = b[rookTo]!;
    b[rookTo] = 0;
  }

  p.castling = u[base + 2]!;
  p.epSquare = u[base + 3]!;
  p.halfmove = u[base + 4]!;
  p.hashHi = u[base + 5]! >>> 0;
  p.hashLo = u[base + 6]! >>> 0;
  const kings = u[base + 7]!;
  p.kingSquare[0] = (kings & 0xff) - 1;
  p.kingSquare[1] = ((kings >> 8) & 0xff) - 1;
  if (us === BLACK) p.fullmove--;
}
