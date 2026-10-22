/**
 * Moves are packed into one integer so hot paths never allocate:
 *
 *   bits 0-6   from square (0x88)
 *   bits 7-13  to square
 *   bits 14-16 promotion piece type (0 none, 2..5 = N B R Q)
 *   bit 17     capture       bit 18 double pawn push
 *   bit 19     en passant    bit 20 castle
 *   bit 21     promotion
 *
 * The captured piece isn't stored in the move; makeMove keeps it on the position's undo stack.
 */
export type Move = number;

export const FLAG_CAPTURE = 1 << 17;
export const FLAG_DOUBLE_PUSH = 1 << 18;
export const FLAG_EN_PASSANT = 1 << 19;
export const FLAG_CASTLE = 1 << 20;
export const FLAG_PROMOTION = 1 << 21;

export function encodeMove(from: number, to: number, promotion: number, flags: number): Move {
  return from | (to << 7) | (promotion << 14) | flags;
}

export function moveFrom(m: Move): number {
  return m & 0x7f;
}

export function moveTo(m: Move): number {
  return (m >>> 7) & 0x7f;
}

/** Promotion piece type (2..5), or 0. */
export function movePromotion(m: Move): number {
  return (m >>> 14) & 7;
}

export function isCapture(m: Move): boolean {
  return (m & FLAG_CAPTURE) !== 0;
}

export function isDoublePush(m: Move): boolean {
  return (m & FLAG_DOUBLE_PUSH) !== 0;
}

export function isEnPassant(m: Move): boolean {
  return (m & FLAG_EN_PASSANT) !== 0;
}

export function isCastle(m: Move): boolean {
  return (m & FLAG_CASTLE) !== 0;
}

export function isPromotion(m: Move): boolean {
  return (m & FLAG_PROMOTION) !== 0;
}
