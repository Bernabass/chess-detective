import { createRng } from '../util/rng';
import { PAWN, WHITE, rankOf } from './board';
import type { Position } from './position';

/**
 * Zobrist hashing: every (piece, square), the side to move, each castling-rights value and
 * each en passant file gets a random 64-bit key (two 32-bit halves, no BigInt). A position's
 * hash is the XOR of the keys of its features, so a move updates it with a few XORs.
 *
 * The keys come from a fixed seed, so hashes are identical on every machine and run.
 */
const ZOBRIST_SEED = 20261022;

export const PIECE_HI = new Uint32Array(13 * 128);
export const PIECE_LO = new Uint32Array(13 * 128);
export const CASTLE_HI = new Uint32Array(16);
export const CASTLE_LO = new Uint32Array(16);
export const EP_HI = new Uint32Array(8);
export const EP_LO = new Uint32Array(8);
/** Key for "Black to move": [hi, lo]. */
export const SIDE_KEY = new Uint32Array(2);

{
  const rng = createRng(ZOBRIST_SEED);
  for (let i = 0; i < PIECE_HI.length; i++) {
    PIECE_HI[i] = rng.nextUint32();
    PIECE_LO[i] = rng.nextUint32();
  }
  // Castling value 0 (no rights) keeps key 0, so positions without rights need no XOR.
  for (let i = 1; i < 16; i++) {
    CASTLE_HI[i] = rng.nextUint32();
    CASTLE_LO[i] = rng.nextUint32();
  }
  for (let i = 0; i < 8; i++) {
    EP_HI[i] = rng.nextUint32();
    EP_LO[i] = rng.nextUint32();
  }
  SIDE_KEY[0] = rng.nextUint32();
  SIDE_KEY[1] = rng.nextUint32();
}

/** Index into PIECE_HI/PIECE_LO for a piece code on a square. */
export function pieceKey(piece: number, sq: number): number {
  return (piece + 6) * 128 + sq;
}

/**
 * Whether the side to move could capture en passant, pseudo-legally (ignoring pins): the en
 * passant square is empty and on the right rank, the double-pushed pawn stands behind it, and
 * a pawn of the side to move stands next to that pawn. Only then is the en passant file part
 * of the hash, so an unusable en passant square never makes two positions hash differently.
 */
export function enPassantCapturable(p: Position): boolean {
  const ep = p.epSquare;
  if (ep < 0) return false;
  const b = p.board;
  if (b[ep] !== 0) return false;
  if (p.turn === WHITE) {
    if (rankOf(ep) !== 5 || b[ep - 16] !== -PAWN) return false;
    const left = ep - 17;
    const right = ep - 15;
    return ((left & 0x88) === 0 && b[left] === PAWN) || ((right & 0x88) === 0 && b[right] === PAWN);
  }
  if (rankOf(ep) !== 2 || b[ep + 16] !== PAWN) return false;
  const left = ep + 15;
  const right = ep + 17;
  return ((left & 0x88) === 0 && b[left] === -PAWN) || ((right & 0x88) === 0 && b[right] === -PAWN);
}

/** The hash computed from scratch. makeMove maintains the same value incrementally. */
export function computeHash(p: Position): { hi: number; lo: number } {
  let hi = 0;
  let lo = 0;
  for (let sq = 0; sq < 128; sq++) {
    const piece = p.board[sq]!;
    if ((sq & 0x88) !== 0 || piece === 0) continue;
    const k = pieceKey(piece, sq);
    hi ^= PIECE_HI[k]!;
    lo ^= PIECE_LO[k]!;
  }
  if (p.turn !== WHITE) {
    hi ^= SIDE_KEY[0]!;
    lo ^= SIDE_KEY[1]!;
  }
  hi ^= CASTLE_HI[p.castling]!;
  lo ^= CASTLE_LO[p.castling]!;
  if (enPassantCapturable(p)) {
    hi ^= EP_HI[p.epSquare & 7]!;
    lo ^= EP_LO[p.epSquare & 7]!;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}
