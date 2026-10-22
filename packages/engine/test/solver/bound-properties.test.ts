import { describe, expect, it } from 'vitest';
import { checkAdmissibility } from './bound-shared';

// SPEC §6.3: the lower bound never exceeds either side's remaining moves (admissibility).
describe('lower bound admissibility over 5,000 seeded random games', () => {
  it('holds in every position, including castling, en passant and promotion games', () => {
    const s = checkAdmissibility(1, 5000, 1500);
    expect(s.games).toBe(5000);
    expect(s.castles).toBeGreaterThan(0);
    expect(s.enPassant).toBeGreaterThan(0);
    expect(s.promotions).toBeGreaterThan(0);
    // The pattern that breaks a forced per-type matching (DECISIONS 2026-10-22).
    expect(s.promotedTwinThenOriginalCaptured).toBeGreaterThan(0);
    // In the first 1,500 games the search's incremental bound agrees with a fresh one at every
    // position and after a side move at every third, through push and pop.
    expect(s.incrementalChecks).toBeGreaterThan(0.3 * s.positions);
  }, 120_000);
});
