import { describe, expect, it } from 'vitest';
import { solveProofGame } from '../../src/index';
import { bruteForceCounts, crossCheck, sample, solveRandomTargets } from './solver-shared';

// SPEC §6.5: the solver's counts must equal brute-force enumeration.
describe('solver count matches brute force (N <= 4)', () => {
  for (const plies of [1, 2]) {
    it(`every target at ${String(plies)} plies`, () => {
      const counts = bruteForceCounts(plies);
      expect(crossCheck(counts, plies, [...counts.keys()])).toBeNull();
    }, 60_000);
  }

  it('1,000 sampled targets at 3 plies (every target in the slow suite)', () => {
    const counts = bruteForceCounts(3);
    expect(crossCheck(counts, 3, sample([...counts.keys()], 1000))).toBeNull();
  }, 60_000);

  it('targets with no 4-ply game at all (from 2-ply games) count 0, as brute force says', () => {
    const four = bruteForceCounts(4);
    const keys = sample([...bruteForceCounts(2).keys()], 40);
    expect(crossCheck(four, 4, keys)).toBeNull();
    expect(keys.some((k) => !four.has(k))).toBe(true); // some really are zero
  }, 120_000);

  it('find-all collects exactly the brute-force number of distinct games (3 plies)', () => {
    const counts = bruteForceCounts(3);
    for (const key of sample([...counts.keys()], 30)) {
      const r = solveProofGame(key, { plies: 3, mode: 'find-all' });
      expect(new Set(r.solutions.map((s) => s.join(' '))).size).toBe(counts.get(key));
    }
  }, 60_000);

  it('150 sampled targets at 4 plies (197,281 games)', () => {
    const counts = bruteForceCounts(4);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(197281);
    expect(crossCheck(counts, 4, sample([...counts.keys()], 150))).toBeNull();
  }, 120_000);
});

// SPEC §6.5: every random game's target is solvable at its own length.
describe('random-game targets are solved completely (N = 1..10)', () => {
  for (let plies = 1; plies <= 10; plies++) {
    it(`2 targets at ${String(plies)} plies`, () => {
      expect(solveRandomTargets(plies * 100, plies, 2)).toBeNull();
    }, 120_000);
  }
});
