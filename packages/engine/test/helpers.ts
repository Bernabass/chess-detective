import { legalMoves, moveToUci, parseFen, type Position } from '../src/index';

export function fen(text: string): Position {
  const r = parseFen(text);
  if (!r.ok) throw new Error(`bad test FEN ${text}: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Legal moves as a sorted list of UCI strings. */
export function ucis(p: Position): string[] {
  return legalMoves(p).map(moveToUci).sort();
}

/** Legal moves starting on one square, as sorted UCI strings. */
export function ucisFrom(p: Position, square: string): string[] {
  return ucis(p).filter((u) => u.startsWith(square));
}
