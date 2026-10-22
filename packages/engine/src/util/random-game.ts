import { initialPosition } from '../core/fen';
import { makeMove } from '../core/makemove';
import { legalMoves } from '../core/movegen';
import {
  isCapture,
  isCastle,
  isEnPassant,
  isPromotion,
  movePromotion,
  type Move,
} from '../core/move';
import type { Position } from '../core/position';
import { KING, PAWN, QUEEN, rankOf } from '../core/board';
import type { Rng } from './rng';

/**
 * Relative chances of each kind of move in random play. Rare special moves are favoured so
 * tests and fixtures actually exercise them.
 */
export function specialMoveWeight(m: Move, p: Position): number {
  if (isEnPassant(m)) return 40;
  if (isCastle(m)) return 20;
  if (isPromotion(m)) return movePromotion(m) === QUEEN ? 10 : 15;
  if (isCapture(m)) return 3;
  // Pawn pushes lead to promotions and en passant chances sooner; moving pieces off the back
  // rank opens the way for castling.
  const from = m & 0x7f;
  const piece = p.board[from]!;
  if (piece === PAWN || piece === -PAWN) return 3;
  const backRank = rankOf(from) === (piece > 0 ? 0 : 7);
  return backRank && piece !== KING && piece !== -KING ? 3 : 1;
}

/**
 * Plays up to `maxPlies` seeded random legal moves from the initial position (stopping early
 * at mate or stalemate) and calls `visit` with each position before its move is played.
 * Returns the moves played and the final position.
 */
export function playRandomGame(
  rng: Rng,
  maxPlies: number,
  visit?: (p: Position, ply: number) => void,
  weight: (m: Move, p: Position) => number = specialMoveWeight,
): { moves: Move[]; position: Position } {
  const p = initialPosition();
  const moves: Move[] = [];
  for (let ply = 0; ply < maxPlies; ply++) {
    const legal = legalMoves(p);
    if (legal.length === 0) break;
    visit?.(p, ply);
    let total = 0;
    for (const m of legal) total += weight(m, p);
    let r = rng.nextFloat() * total;
    let chosen = legal[legal.length - 1]!;
    for (const m of legal) {
      r -= weight(m, p);
      if (r < 0) {
        chosen = m;
        break;
      }
    }
    makeMove(p, chosen);
    moves.push(chosen);
  }
  return { moves, position: p };
}
