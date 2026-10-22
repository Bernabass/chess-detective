import { describe, expect, it } from 'vitest';
import { checkAdmissibility } from './bound-shared';

// SPEC §6.3: admissibility over 100,000 games in the slow suite, in four files of 25,000
// (seeds from 4000001) so Vitest runs them in parallel.
describe('lower bound admissibility (slow), part 4 of 4', () => {
  it('holds over 25,000 seeded random games', () => {
    const s = checkAdmissibility(4000001, 25_000);
    expect(s.games).toBe(25_000);
    expect(s.promotedTwinThenOriginalCaptured).toBeGreaterThan(0);
  });
});
