/**
 * 0x88 board geometry and piece codes.
 *
 * A square is `rank * 16 + file` (a1 = 0, h1 = 7, a8 = 112, h8 = 119). The 8 columns to the
 * right of each rank are padding, so `sq & 0x88` is non-zero exactly when a square is off the
 * board, which makes edge checks a single AND. Pieces are 1..6 = P N B R Q K for White,
 * negated for Black, 0 for empty.
 */

export type Side = 0 | 1;
export const WHITE: Side = 0;
export const BLACK: Side = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const NO_SQUARE = -1;

// Castling-right bits, in FEN order KQkq.
export const WHITE_KINGSIDE = 1;
export const WHITE_QUEENSIDE = 2;
export const BLACK_KINGSIDE = 4;
export const BLACK_QUEENSIDE = 8;

export const A1 = 0x00;
export const B1 = 0x01;
export const C1 = 0x02;
export const D1 = 0x03;
export const E1 = 0x04;
export const F1 = 0x05;
export const G1 = 0x06;
export const H1 = 0x07;
export const A8 = 0x70;
export const B8 = 0x71;
export const C8 = 0x72;
export const D8 = 0x73;
export const E8 = 0x74;
export const F8 = 0x75;
export const G8 = 0x76;
export const H8 = 0x77;

export function fileOf(sq: number): number {
  return sq & 7;
}

export function rankOf(sq: number): number {
  return sq >> 4;
}

export function isOnBoard(sq: number): boolean {
  return (sq & 0x88) === 0;
}

/** Square name like "e4". */
export function squareName(sq: number): string {
  return String.fromCharCode(97 + (sq & 7)) + String((sq >> 4) + 1);
}

/** Square index for a name like "e4", or -1 if the name isn't a square. */
export function squareFromName(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) return NO_SQUARE;
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

const PIECE_LETTERS = 'pnbrqk';

/** FEN letter for a piece code: uppercase for White, lowercase for Black. */
export function pieceLetter(piece: number): string {
  const letter = PIECE_LETTERS.charAt(Math.abs(piece) - 1);
  return piece > 0 ? letter.toUpperCase() : letter;
}

/** Piece code for a FEN letter, or 0 if it isn't one (exact match: no Unicode case folding). */
export function pieceFromLetter(ch: string): number {
  const white = 'PNBRQK'.indexOf(ch);
  if (white >= 0) return white + 1;
  const black = PIECE_LETTERS.indexOf(ch);
  return black >= 0 ? -(black + 1) : 0;
}
