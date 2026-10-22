import {
  createRng,
  initialPosition,
  legalMoves,
  makeMove,
  moveToUci,
  replay,
  solveProofGame,
  targetKey,
  unmakeMove,
  type Position,
} from '../../src/index';
import { playRandomGame } from '../../src/util/random-game';

/** Every game of exactly `plies` plies from the start, counted by final target key. */
export function bruteForceCounts(plies: number): Map<string, number> {
  const counts = new Map<string, number>();
  const p = initialPosition();
  const walk = (depth: number): void => {
    if (depth === 0) {
      const key = targetKey(p);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return;
    }
    for (const m of legalMoves(p)) {
      makeMove(p, m);
      walk(depth - 1);
      unmakeMove(p);
    }
  };
  walk(plies);
  return counts;
}

/** Up to `n` keys spread evenly over the sorted keys (deterministic sample). */
export function sample(keys: readonly string[], n: number): string[] {
  const sorted = [...keys].sort();
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor((i * sorted.length) / n)] ?? '');
}

/**
 * Compares the solver's count with the brute-force count for each target at `plies`. Returns
 * the first mismatch as text, or null.
 */
export function crossCheck(
  counts: Map<string, number>,
  plies: number,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const expected = counts.get(key) ?? 0;
    const r = solveProofGame(key, { plies, mode: 'count' });
    if (r.status !== 'complete' || r.count !== expected) {
      return `${key} at ${String(plies)} plies: solver ${String(r.count)} (${r.status}), brute force ${String(expected)}`;
    }
  }
  return null;
}

/**
 * Targets of seeded random games of exactly `plies` plies must be solvable at `plies`: status
 * complete, count >= 1, and a found proof replays to the target. Returns a failure text or null.
 */
export function solveRandomTargets(firstSeed: number, plies: number, games: number): string | null {
  for (let seed = firstSeed; seed < firstSeed + games; seed++) {
    let position: Position | null = null;
    // Re-seed until the random game really lasts `plies` plies (no early mate).
    for (let attempt = 0; position === null; attempt++) {
      const g = playRandomGame(createRng(seed * 1000 + attempt), plies);
      if (g.moves.length === plies) position = g.position;
    }
    const key = targetKey(position);
    const r = solveProofGame(key, { plies, mode: 'find-one' });
    const proof = r.solutions[0];
    if (r.status !== 'complete' || r.count < 1 || proof === undefined) {
      return `seed ${String(seed)}: ${key} at ${String(plies)} plies: ${r.status}, count ${String(r.count)}`;
    }
    const replayed = replay(proof);
    if (!replayed.ok || targetKey(replayed.value) !== key || proof.length !== plies) {
      return `seed ${String(seed)}: proof ${proof.join(' ')} doesn't reach ${key}`;
    }
  }
  return null;
}

/** For tests that want UCI strings of the legal moves. */
export function ucis(p: Position): string[] {
  return legalMoves(p).map(moveToUci);
}
