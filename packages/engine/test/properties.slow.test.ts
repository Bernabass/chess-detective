import fc from 'fast-check';
import { describe, it } from 'vitest';
import { checkRandomGame } from './properties-shared';

describe('engine properties over seeded random games (slow)', () => {
  it('hold over 400 longer games', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        checkRandomGame(seed, 200);
      }),
      { seed: 1022, numRuns: 400, endOnFailure: true },
    );
  });
});
