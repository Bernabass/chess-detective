import { describe, expect, it } from 'vitest';
import { diagramStatistics } from './solver-shared';

// See wismuth-properties.test.ts. N = 5 enumerates 4,865,609 games.
const ALL = [1, 20, 400, 5362, 71852, 815677];
const UNIQUELY_REALIZABLE = [1, 20, 400, 1862, 9373, 51323];
// Ours: also no shorter game. At N = 4, 64 targets are reached by exactly one 4-ply game but also
// in 2 plies (1.a3 a6 2.a4 a5 is the only 4-ply game, but 1.a4 a5 is shorter).
const UNIQUE_SHORTEST = [1, 20, 400, 1862, 9309, 51187];

describe('brute-force diagram statistics match wismuth.com (slow, N <= 5)', () => {
  it('815,677 diagrams at N = 5, 51,323 uniquely realizable (51,187 also shortest)', () => {
    const stats = diagramStatistics(5);
    expect(stats.map((s) => s.all)).toEqual(ALL);
    expect(stats.map((s) => s.uniquelyRealizable)).toEqual(UNIQUELY_REALIZABLE);
    expect(stats.map((s) => s.uniqueShortest)).toEqual(UNIQUE_SHORTEST);
  });
});
