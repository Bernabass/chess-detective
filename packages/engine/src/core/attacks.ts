import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, type Side } from './board';
import type { Position } from './position';

export const KNIGHT_STEPS = [33, 31, 18, 14, -14, -18, -31, -33] as const;
export const KING_STEPS = [17, 16, 15, 1, -1, -15, -16, -17] as const;
export const ROOK_STEPS = [16, -16, 1, -1] as const;
export const BISHOP_STEPS = [17, 15, -15, -17] as const;

/**
 * Whether `by` attacks `sq`. Works outward from the target square: pawn and knight and king
 * squares are single lookups, and each of the 8 rays stops at the first piece it meets.
 */
export function isAttacked(board: Int8Array, sq: number, by: Side): boolean {
  const sign = by === WHITE ? 1 : -1;
  // A white pawn on sq-15 or sq-17 attacks sq; a black one on sq+15 or sq+17.
  const p1 = by === WHITE ? sq - 15 : sq + 15;
  const p2 = by === WHITE ? sq - 17 : sq + 17;
  if ((p1 & 0x88) === 0 && board[p1] === sign * PAWN) return true;
  if ((p2 & 0x88) === 0 && board[p2] === sign * PAWN) return true;

  const knight = sign * KNIGHT;
  for (const d of KNIGHT_STEPS) {
    const s = sq + d;
    if ((s & 0x88) === 0 && board[s] === knight) return true;
  }
  const king = sign * KING;
  for (const d of KING_STEPS) {
    const s = sq + d;
    if ((s & 0x88) === 0 && board[s] === king) return true;
  }
  const rook = sign * ROOK;
  const queen = sign * QUEEN;
  for (const d of ROOK_STEPS) {
    for (let s = sq + d; (s & 0x88) === 0; s += d) {
      const v = board[s];
      if (v !== 0) {
        if (v === rook || v === queen) return true;
        break;
      }
    }
  }
  const bishop = sign * BISHOP;
  for (const d of BISHOP_STEPS) {
    for (let s = sq + d; (s & 0x88) === 0; s += d) {
      const v = board[s];
      if (v !== 0) {
        if (v === bishop || v === queen) return true;
        break;
      }
    }
  }
  return false;
}

/** Squares of the pieces giving check to the side to move (empty if not in check or no king). */
export function findCheckers(p: Position): number[] {
  const king = p.kingSquare[p.turn]!;
  const result: number[] = [];
  if (king < 0) return result;
  const b = p.board;
  const by: Side = p.turn === WHITE ? 1 : 0;
  const sign = by === WHITE ? 1 : -1;

  for (const s of by === WHITE ? [king - 15, king - 17] : [king + 15, king + 17]) {
    if ((s & 0x88) === 0 && b[s] === sign * PAWN) result.push(s);
  }
  for (const d of KNIGHT_STEPS) {
    const s = king + d;
    if ((s & 0x88) === 0 && b[s] === sign * KNIGHT) result.push(s);
  }
  for (const d of KING_STEPS) {
    const s = king + d;
    if ((s & 0x88) === 0 && b[s] === sign * KING) result.push(s);
  }
  const rays: [readonly number[], number][] = [
    [ROOK_STEPS, ROOK],
    [BISHOP_STEPS, BISHOP],
  ];
  for (const [steps, slider] of rays) {
    for (const d of steps) {
      for (let s = king + d; (s & 0x88) === 0; s += d) {
        const v = b[s];
        if (v !== 0) {
          if (v === sign * slider || v === sign * QUEEN) result.push(s);
          break;
        }
      }
    }
  }
  return result.sort((x, y) => x - y);
}
