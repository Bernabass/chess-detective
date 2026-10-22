import { NO_SQUARE, WHITE, type Side } from './board';

/** Ints per undo record: move, captured piece, castling, ep square, halfmove, hash hi, hash lo, king squares. */
export const UNDO_STRIDE = 8;

/**
 * A chess position plus the undo stack of the moves made on it.
 *
 * Fields are public for speed; change them only through makeMove/unmakeMove (or parseFen),
 * which keep the counts, king squares and hash consistent.
 */
export class Position {
  /** 0x88 board: index = rank * 16 + file. */
  readonly board = new Int8Array(128);
  turn: Side = WHITE;
  /** Castling-right bits (see board.ts). */
  castling = 0;
  /** En passant target square as written in FEN, or -1. */
  epSquare = NO_SQUARE;
  halfmove = 0;
  fullmove = 1;
  /** One king square per side, or -1 if that side has no king (possible in illegal positions). */
  readonly kingSquare = new Int16Array([NO_SQUARE, NO_SQUARE]);
  /** Piece counts indexed by piece code + 6 (index 6, "empty", is unused). */
  readonly counts = new Uint8Array(13);
  /** Zobrist hash, two unsigned 32-bit halves. */
  hashHi = 0;
  hashLo = 0;
  /** Number of moves on the undo stack. */
  ply = 0;
  undo: Int32Array;

  /** `undoCapacity` is a starting size in moves; the stack grows when needed. */
  constructor(undoCapacity = 128) {
    this.undo = new Int32Array(UNDO_STRIDE * Math.max(1, undoCapacity));
  }
}

/** An independent copy, including the undo stack (so the copy can unmake earlier moves too). */
export function clonePosition(p: Position): Position {
  const q = new Position(p.ply + 16);
  q.board.set(p.board);
  q.turn = p.turn;
  q.castling = p.castling;
  q.epSquare = p.epSquare;
  q.halfmove = p.halfmove;
  q.fullmove = p.fullmove;
  q.kingSquare.set(p.kingSquare);
  q.counts.set(p.counts);
  q.hashHi = p.hashHi;
  q.hashLo = p.hashLo;
  q.ply = p.ply;
  q.undo.set(p.undo.subarray(0, p.ply * UNDO_STRIDE));
  return q;
}
