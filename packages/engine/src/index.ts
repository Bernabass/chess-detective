/**
 * Public API of the Retrograde engine. Everything else under src/ is internal.
 */
import { BLACK, WHITE, pieceLetter } from './core/board';
import { isAttacked, findCheckers } from './core/attacks';
import type { Position } from './core/position';

/** Engine version, recorded with every generated puzzle. Keep in sync with package.json. */
export const ENGINE_VERSION = '0.4.0';

export type Color = 'w' | 'b';

export type { Result } from './util/result';
export type { Rng } from './util/rng';
export { createRng } from './util/rng';

export type { Move } from './core/move';
export type { FenError } from './core/fen';
export { Position, clonePosition } from './core/position';
export { squareFromName, squareName } from './core/board';
export { START_FEN, initialPosition, parseFen, targetKey, toFen } from './core/fen';
export { inCheck, legalMoves } from './core/movegen';
export { makeMove, unmakeMove } from './core/makemove';
export { moveToUci, uciToMove } from './core/uci';
export { moveToSan, sanToMove } from './core/san';
export { replay } from './core/replay';
export { perft } from './core/perft';

/** Whose turn it is. */
export function sideToMove(p: Position): Color {
  return p.turn === WHITE ? 'w' : 'b';
}

/** The FEN letter of the piece on a square (e.g. "K", "p"), or null if it's empty. */
export function pieceAt(p: Position, square: number): string | null {
  if ((square & 0x88) !== 0 || square < 0) return null;
  const piece = p.board[square]!;
  return piece === 0 ? null : pieceLetter(piece);
}

/** Whether `by` attacks `square` (0x88 index, see squareFromName). False for an invalid square. */
export function isSquareAttacked(p: Position, square: number, by: Color): boolean {
  if ((square & 0x88) !== 0 || square < 0) return false;
  return isAttacked(p.board, square, by === 'w' ? WHITE : BLACK);
}

/** Squares (0x88 indices) of the pieces giving check to the side to move. */
export function checkers(p: Position): number[] {
  return findCheckers(p);
}

export type { Finding, RuleId, Severity } from './retro/findings';
export { staticFindings } from './retro/rules';
export type { Retraction, RetractionKind } from './retro/retract';
export { retractions } from './retro/retract';
export type { LastMove, LastMovesOptions, LastMovesResult, Viability } from './retro/lastmoves';
export { lastMoves } from './retro/lastmoves';
export type { AnalysisReport, AnalyzeOptions, Verdict } from './retro/analyze';
export { analyzePosition } from './retro/analyze';
export type { SolveOptions, SolveResult } from './solver/search';
export { solveProofGame } from './solver/search';
export type { ShortestOptions, ShortestResult } from './solver/shortest';
export { minimumPlies, shortestProofGame } from './solver/shortest';

export { dailyFeedback } from './daily/feedback';
