import { describe, expect, it } from 'vitest';
import { runRetroProperty } from './retro-shared';

// SPEC §5.5: completeness and soundness over 2,000 positions in the fast suite, split into four
// files of 500 (seed ranges 1..) so Vitest runs them in parallel.
describe('retraction completeness and soundness, part 1 of 4', () => {
  it('holds for every legal move in 500 positions from seeded random games', () => {
    const s = runRetroProperty(1, 500);
    expect(s.positions).toBeGreaterThanOrEqual(500);
    // The games must exercise the special moves, as last moves to retract.
    expect(s.enPassant).toBeGreaterThan(0);
    expect(s.castles).toBeGreaterThan(0);
    expect(s.promotions).toBeGreaterThan(0);
  }, 300_000);
});
