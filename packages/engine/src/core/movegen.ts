import { BISHOP_STEPS, KING_STEPS, KNIGHT_STEPS, ROOK_STEPS, isAttacked } from './attacks';
import {
  A1,
  A8,
  B1,
  B8,
  BISHOP,
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
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  rankOf,
  type Side,
} from './board';
import { makeMove, unmakeMove } from './makemove';
import {
  FLAG_CAPTURE,
  FLAG_CASTLE,
  FLAG_DOUBLE_PUSH,
  FLAG_EN_PASSANT,
  FLAG_PROMOTION,
  encodeMove,
  type Move,
} from './move';
import type { Position } from './position';

/**
 * Upper bound on pseudo-legal moves in any position that parses, legal or not: at most 64
 * pieces with at most 27 moves each (a queen on an open board) is 1728.
 */
export const MAX_MOVES = 2048;

const PROMOTION_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT] as const;

/**
 * Writes the pseudo-legal moves of the side to move into `out` and returns how many.
 * Castling and en passant come from the board itself, never from the flags alone, so
 * inconsistent FEN fields can't produce impossible moves.
 */
export function generatePseudoMoves(p: Position, out: Int32Array): number {
  const b = p.board;
  const us = p.turn;
  const sign = us === WHITE ? 1 : -1;
  let n = 0;

  for (let sq = 0; sq < 120; sq++) {
    if ((sq & 0x88) !== 0) {
      sq += 7; // skip the padding columns of this rank
      continue;
    }
    const piece = b[sq]! * sign;
    if (piece <= 0) continue;

    switch (piece) {
      case PAWN:
        n = pawnMoves(p, sq, us, out, n);
        break;
      case KNIGHT:
        n = stepMoves(b, sq, sign, KNIGHT_STEPS, out, n);
        break;
      case KING:
        n = stepMoves(b, sq, sign, KING_STEPS, out, n);
        break;
      case BISHOP:
        n = slideMoves(b, sq, sign, BISHOP_STEPS, out, n);
        break;
      case ROOK:
        n = slideMoves(b, sq, sign, ROOK_STEPS, out, n);
        break;
      default: // QUEEN
        n = slideMoves(b, sq, sign, BISHOP_STEPS, out, n);
        n = slideMoves(b, sq, sign, ROOK_STEPS, out, n);
    }
  }
  return castlingMoves(p, us, out, n);
}

function stepMoves(
  b: Int8Array,
  from: number,
  sign: number,
  steps: readonly number[],
  out: Int32Array,
  n: number,
): number {
  for (const d of steps) {
    const to = from + d;
    if ((to & 0x88) !== 0) continue;
    const target = b[to]! * sign;
    if (target > 0) continue;
    out[n++] = encodeMove(from, to, 0, target < 0 ? FLAG_CAPTURE : 0);
  }
  return n;
}

function slideMoves(
  b: Int8Array,
  from: number,
  sign: number,
  steps: readonly number[],
  out: Int32Array,
  n: number,
): number {
  for (const d of steps) {
    for (let to = from + d; (to & 0x88) === 0; to += d) {
      const target = b[to]! * sign;
      if (target > 0) break;
      if (target < 0) {
        out[n++] = encodeMove(from, to, 0, FLAG_CAPTURE);
        break;
      }
      out[n++] = encodeMove(from, to, 0, 0);
    }
  }
  return n;
}

function addPawnMove(from: number, to: number, flags: number, out: Int32Array, n: number): number {
  const lastRank = rankOf(to) === 7 || rankOf(to) === 0;
  if (!lastRank) {
    out[n++] = encodeMove(from, to, 0, flags);
    return n;
  }
  for (const piece of PROMOTION_PIECES) {
    out[n++] = encodeMove(from, to, piece, flags | FLAG_PROMOTION);
  }
  return n;
}

function pawnMoves(p: Position, from: number, us: Side, out: Int32Array, n: number): number {
  const b = p.board;
  const forward = us === WHITE ? 16 : -16;
  const startRank = us === WHITE ? 1 : 6;

  const one = from + forward;
  if ((one & 0x88) === 0 && b[one] === 0) {
    n = addPawnMove(from, one, 0, out, n);
    const two = one + forward;
    if (rankOf(from) === startRank && b[two] === 0) {
      out[n++] = encodeMove(from, two, 0, FLAG_DOUBLE_PUSH);
    }
  }
  n = pawnCapture(p, from, one - 1, us, out, n);
  return pawnCapture(p, from, one + 1, us, out, n);
}

function pawnCapture(
  p: Position,
  from: number,
  to: number,
  us: Side,
  out: Int32Array,
  n: number,
): number {
  if ((to & 0x88) !== 0) return n;
  const b = p.board;
  const target = b[to]!;
  if (us === WHITE ? target < 0 : target > 0) return addPawnMove(from, to, FLAG_CAPTURE, out, n);
  const behind = us === WHITE ? to - 16 : to + 16;
  if (
    target === 0 &&
    to === p.epSquare &&
    rankOf(to) === (us === WHITE ? 5 : 2) &&
    b[behind] === (us === WHITE ? -PAWN : PAWN)
  ) {
    out[n++] = encodeMove(from, to, 0, FLAG_CAPTURE | FLAG_EN_PASSANT);
  }
  return n;
}

function castlingMoves(p: Position, us: Side, out: Int32Array, n: number): number {
  const b = p.board;
  const them: Side = us === WHITE ? BLACK : WHITE;
  const white = us === WHITE;
  const king = white ? KING : -KING;
  const rook = white ? ROOK : -ROOK;
  const e = white ? E1 : E8;
  if (b[e] !== king) return n;

  const kingside = white ? WHITE_KINGSIDE : BLACK_KINGSIDE;
  const queenside = white ? WHITE_QUEENSIDE : BLACK_QUEENSIDE;
  if ((p.castling & (kingside | queenside)) === 0) return n;
  if (isAttacked(b, e, them)) return n;

  // The destination is checked here as well as by the legality filter, because in an illegal
  // position with two kings of one colour the filter only knows about one of them.
  const f = white ? F1 : F8;
  const g = white ? G1 : G8;
  const h = white ? H1 : H8;
  if (
    (p.castling & kingside) !== 0 &&
    b[h] === rook &&
    b[f] === 0 &&
    b[g] === 0 &&
    !isAttacked(b, f, them) &&
    !isAttacked(b, g, them)
  ) {
    out[n++] = encodeMove(e, g, 0, FLAG_CASTLE);
  }
  const a = white ? A1 : A8;
  const bSq = white ? B1 : B8;
  const c = white ? C1 : C8;
  const d = white ? D1 : D8;
  if (
    (p.castling & queenside) !== 0 &&
    b[a] === rook &&
    b[bSq] === 0 &&
    b[c] === 0 &&
    b[d] === 0 &&
    !isAttacked(b, d, them) &&
    !isAttacked(b, c, them)
  ) {
    out[n++] = encodeMove(e, c, 0, FLAG_CASTLE);
  }
  return n;
}

/**
 * ON_LINE[a - b + 119] is 1 when squares a and b share a rank, file or diagonal. A piece can
 * only be pinned to its king if it's on such a line with the king.
 */
const ON_LINE = new Uint8Array(239);
for (const d of [...ROOK_STEPS, ...BISHOP_STEPS]) {
  for (let k = 1; k < 8; k++) ON_LINE[d * k + 119] = 1;
}

/**
 * Whether a pseudo-legal move is legal. The full test makes the move and checks whether the
 * mover's king is attacked. When the king isn't in check (`checked` false), a move that isn't
 * a king move or en passant can only be illegal if the moving piece is pinned, which needs the
 * piece to be on a line with its king; every other move skips the full test.
 */
function isLegal(p: Position, m: Move, king: number, checked: boolean): boolean {
  if (king < 0) return true; // no king (illegal position): nothing to leave in check
  const from = m & 0x7f;
  if (
    !checked &&
    from !== king &&
    (m & FLAG_EN_PASSANT) === 0 &&
    ON_LINE[from - king + 119] === 0
  ) {
    return true;
  }
  const us = p.turn;
  makeMove(p, m);
  const legal = !isAttacked(p.board, p.kingSquare[us]!, us === WHITE ? BLACK : WHITE);
  unmakeMove(p);
  return legal;
}

/** Whether the side to move's king is attacked (false if it has no king). */
function kingAttacked(p: Position, king: number): boolean {
  return king >= 0 && isAttacked(p.board, king, p.turn === WHITE ? BLACK : WHITE);
}

/** Writes the legal moves into `out` and returns how many. */
export function generateLegalMoves(p: Position, out: Int32Array): number {
  const count = generatePseudoMoves(p, out);
  const king = p.kingSquare[p.turn]!;
  const checked = kingAttacked(p, king);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const m = out[i]!;
    if (isLegal(p, m, king, checked)) out[n++] = m;
  }
  return n;
}

/**
 * Scratch buffer for legalMoves and hasLegalMove. Safe to share: move generation never calls
 * either function, and both finish with the buffer before returning.
 */
const scratch = new Int32Array(MAX_MOVES);

/** The legal moves of the side to move. */
export function legalMoves(p: Position): Move[] {
  return Array.from(scratch.subarray(0, generateLegalMoves(p, scratch)));
}

/** Whether the side to move has any legal move (stops at the first one). */
export function hasLegalMove(p: Position): boolean {
  const count = generatePseudoMoves(p, scratch);
  const king = p.kingSquare[p.turn]!;
  const checked = kingAttacked(p, king);
  for (let i = 0; i < count; i++) {
    if (isLegal(p, scratch[i]!, king, checked)) return true;
  }
  return false;
}

/** Whether the side to move is in check. */
export function inCheck(p: Position): boolean {
  return kingAttacked(p, p.kingSquare[p.turn]!);
}
