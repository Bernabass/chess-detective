import {
  initialPosition,
  legalMoves,
  makeMove,
  moveToUci,
  targetKey,
  unmakeMove,
  type Position,
} from '@retrograde/engine';
import { expect } from 'vitest';
import { verifyCandidate } from '../src/verify';

/** Every target reachable in exactly `plies` plies, with how many games reach it and one of them. */
export function bruteForce(plies: number): Map<string, { games: number; moves: string[] }> {
  const out = new Map<string, { games: number; moves: string[] }>();
  const p: Position = initialPosition();
  const path: string[] = [];
  const walk = (left: number): void => {
    if (left === 0) {
      const key = targetKey(p);
      const seen = out.get(key);
      if (seen) seen.games++;
      else out.set(key, { games: 1, moves: [...path] });
      return;
    }
    for (const m of legalMoves(p)) {
      makeMove(p, m);
      path.push(moveToUci(m));
      walk(left - 1);
      path.pop();
      unmakeMove(p);
    }
  };
  walk(plies);
  return out;
}

/**
 * Checks verifyCandidate on every `stride`-th of the 71,852 targets reachable in 4 plies against
 * brute force: accepted exactly when one 4-ply game reaches it and no 2-ply game does.
 */
export function checkFourPlyTargets(stride: number): { checked: number; accepted: number } {
  const four = bruteForce(4);
  const two = bruteForce(2);
  let checked = 0;
  let accepted = 0;
  let i = 0;
  for (const [key, { games, moves }] of four) {
    if (i++ % stride !== 0) continue;
    const expected =
      games === 1 && !two.has(key) ? 'accepted' : games > 1 ? 'not-unique' : 'not-shortest';
    expect(verifyCandidate(key, 4, 1_000_000, moves).status, `${key} (${moves.join(' ')})`).toBe(
      expected,
    );
    checked++;
    if (expected === 'accepted') accepted++;
  }
  return { checked, accepted };
}
