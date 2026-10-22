import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkAnalyzerClaims } from './retro-shared';

describe('analyzePosition claims on positions from real games (slow)', () => {
  it('hold at depth 3 over 3,000+ positions', () => {
    let positions = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        positions += checkAnalyzerClaims(seed, 80, 3);
      }),
      { seed: 20261024, numRuns: 40, endOnFailure: true },
    );
    expect(positions).toBeGreaterThanOrEqual(3000);
  });
});
