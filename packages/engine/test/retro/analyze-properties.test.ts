import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkAnalyzerClaims } from './retro-shared';

// The claims analyzePosition makes must hold for positions that really occur: none of them is
// illegal, and a forced last move is the move that was actually played. fast-check prints the
// failing seed; this fixed seed makes runs repeatable.
describe('analyzePosition claims on positions from real games', () => {
  it('never calls them illegal, and LAST_MOVE_FORCED always names the move played', () => {
    let positions = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        positions += checkAnalyzerClaims(seed, 40, 2);
      }),
      { seed: 20261023, numRuns: 6, endOnFailure: true },
    );
    expect(positions).toBeGreaterThanOrEqual(200);
  }, 300_000);
});
