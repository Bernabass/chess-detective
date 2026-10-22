import { err, ok, type Result } from '../util/result';
import { initialPosition } from './fen';
import { makeMove } from './makemove';
import type { Position } from './position';
import { uciToMove } from './uci';

/** Plays UCI moves from the initial position; reports the first illegal or malformed one. */
export function replay(
  ucis: readonly string[],
): Result<Position, { illegalAt: number; reason: string }> {
  const p = initialPosition();
  for (const [i, uci] of ucis.entries()) {
    const r = uciToMove(p, uci);
    if (!r.ok) return err({ illegalAt: i, reason: r.error });
    makeMove(p, r.value);
  }
  return ok(p);
}
