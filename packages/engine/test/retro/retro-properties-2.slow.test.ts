import { describe, expect, it } from 'vitest';
import { runRetroProperty } from './retro-shared';

// SPEC §5.5: 50,000 positions in the slow suite, split into four files of 12,500 (seeds from
// 200001) so Vitest runs them in parallel.
describe('retraction completeness and soundness (slow), part 2 of 4', () => {
  it('holds for every legal move in 12,500 positions from seeded random games', () => {
    const s = runRetroProperty(200001, 12_500, 150);
    expect(s.positions).toBeGreaterThanOrEqual(12_500);
  });
});
