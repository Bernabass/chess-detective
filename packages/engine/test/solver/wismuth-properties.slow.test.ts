import { describe, expect, it } from 'vitest';
import { diagramStatistics } from './solver-shared';

// See wismuth-properties.test.ts. N = 5 enumerates 4,865,609 games.
describe('brute-force diagram statistics match wismuth.com (slow, N = 5)', () => {
  it('815,677 diagrams, 51,323 uniquely realizable (51,187 also shortest)', () => {
    const stats = diagramStatistics(5);
    expect(stats[5]).toMatchObject({
      all: 815677,
      uniquelyRealizable: 51323,
      uniqueShortest: 51187,
    });
  });
});
