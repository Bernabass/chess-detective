import { describe, expect, it } from 'vitest';
import { bruteForceCounts, crossCheck, sample, solveRandomTargets } from './solver-shared';

describe('solver count matches brute force at 3 and 5 plies (slow)', () => {
  it('every target at 3 plies', () => {
    const counts = bruteForceCounts(3);
    expect(crossCheck(counts, 3, [...counts.keys()])).toBeNull();
  });

  it('500 sampled targets at 4 plies', () => {
    const counts = bruteForceCounts(4);
    expect(crossCheck(counts, 4, sample([...counts.keys()], 500))).toBeNull();
  });

  it('500 sampled targets among 4,865,609 games', () => {
    const counts = bruteForceCounts(5);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(4865609);
    expect(crossCheck(counts, 5, sample([...counts.keys()], 500))).toBeNull();
  });
});

describe('random-game targets are solved completely (slow, N = 1..10)', () => {
  for (let plies = 1; plies <= 10; plies++) {
    it(`20 targets at ${String(plies)} plies`, () => {
      expect(solveRandomTargets(plies * 10_000, plies, 20)).toBeNull();
    });
  }
});
