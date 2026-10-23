import { describe, expect, it } from 'vitest';
import { runRetroProperty } from './retro-shared';

// SPEC §5.5: completeness and soundness over 300 positions in the fast suite (50,000 in the
// slow suite), split into two files of 150 (seeds 1001..) so Vitest runs them in parallel.
describe('retraction completeness and soundness, part 2 of 2', () => {
  it('holds for every legal move in 150 positions from seeded random games', () => {
    const s = runRetroProperty(1001, 150);
    expect(s.positions).toBeGreaterThanOrEqual(150);
    // The games must exercise the special moves, as last moves to retract.
    expect(s.enPassant).toBeGreaterThan(0);
    expect(s.castles).toBeGreaterThan(0);
    expect(s.promotions).toBeGreaterThan(0);
  }, 300_000);
});
