import { describe, expect, it } from 'vitest';
import { quotasFor } from '../src/generate';
import { choosePool, MAX_PER_PREFIX, PLY_QUOTAS } from '../src/pool';

/** Fake accepted puzzles: `per` of each length 5-12, each with its own 6-ply prefix. */
function fakes(per: number): { index: number; moves: string[]; score: number }[] {
  const out: { index: number; moves: string[]; score: number }[] = [];
  for (let plies = 5; plies <= 12; plies++) {
    for (let i = 0; i < per; i++) {
      const index = out.length;
      out.push({
        index,
        moves: Array.from({ length: plies }, (_, k) => `m${String(index)}-${String(k)}`),
        score: index % 17,
      });
    }
  }
  return out;
}

describe('choosePool', () => {
  it('fills the ply quotas exactly when there are enough puzzles', () => {
    const { chosen, quotas } = choosePool(fakes(200), 500);
    expect(chosen).toHaveLength(500);
    expect(quotas.map((q) => q.wanted)).toEqual([75, 140, 75, 140, 70]);
    expect(quotas.every((q) => q.found === q.wanted)).toBe(true);
    for (const [i, quota] of PLY_QUOTAS.entries()) {
      const n = chosen.filter(
        (c) => c.moves.length >= quota.min && c.moves.length <= quota.max,
      ).length;
      expect(n).toBe(quotas[i]?.wanted);
    }
  });

  it('keeps at most 3 puzzles per 6-ply prefix', () => {
    const shared = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      moves: ['a', 'b', 'c', 'd', 'e', 'f', 'g', String(i), 'x', 'y'],
      score: 10 - i,
    }));
    const { chosen } = choosePool(shared, 10);
    expect(chosen).toHaveLength(MAX_PER_PREFIX);
    expect(chosen.map((c) => c.index)).toEqual([0, 1, 2]); // the highest scores
  });

  it('tops up a short range from the others and sorts by index', () => {
    const few = fakes(200).filter((f) => f.moves.length !== 12);
    const { chosen, quotas } = choosePool(few, 500);
    expect(chosen).toHaveLength(500);
    expect(quotas[4]).toMatchObject({ wanted: 70, found: 0 });
    expect(chosen.map((c) => c.index)).toEqual(
      [...chosen.map((c) => c.index)].sort((a, b) => a - b),
    );
  });
});

describe('quotasFor', () => {
  it('clips the quotas to the ply range and rescales them', () => {
    expect(quotasFor(5, 12)).toEqual(PLY_QUOTAS);
    const q = quotasFor(5, 8);
    expect(q.map((x) => [x.min, x.max])).toEqual([
      [5, 6],
      [7, 8],
    ]);
    expect(q.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(quotasFor(1, 4)).toEqual([{ min: 1, max: 4, share: 1 }]);
    // Lengths outside 5-12 join the nearest quota instead of being dropped.
    expect(quotasFor(3, 5)).toEqual([{ min: 3, max: 5, share: 1 }]);
    expect(quotasFor(5, 14).at(-1)).toMatchObject({ min: 12, max: 14 });
  });
});
