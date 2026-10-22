import { describe, expect, it } from 'vitest';
import { checkAdmissibility } from './bound-shared';

// ARCHITECTURE.md §6.3: the lower bound never exceeds either side's remaining moves (admissibility).
describe('lower bound admissibility over 5,000 seeded random games', () => {
  it('holds in every position, including castling, en passant and promotion games', () => {
    const s = checkAdmissibility(1, 5000);
    expect(s.games).toBe(5000);
    expect(s.castles).toBeGreaterThan(0);
    expect(s.enPassant).toBeGreaterThan(0);
    expect(s.promotions).toBeGreaterThan(0);
    // The pattern that breaks a forced per-type matching (ARCHITECTURE.md §6.3).
    expect(s.promotedTwinThenOriginalCaptured).toBeGreaterThan(0);
  }, 120_000);
});
