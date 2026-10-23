import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkRandomGame, type GameStats } from './properties-shared';

// fast-check prints the failing seed and counterexample; this fixed seed makes runs repeatable.
const FC_SEED = 20261022;

describe('engine properties over seeded random games', () => {
  it('FEN, make/unmake, Zobrist and SAN/UCI round-trips hold in every position', () => {
    const total: GameStats = { positions: 0, castles: 0, enPassants: 0, promotions: 0 };
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        const s = checkRandomGame(seed, 120);
        total.positions += s.positions;
        total.castles += s.castles;
        total.enPassants += s.enPassants;
        total.promotions += s.promotions;
      }),
      // endOnFailure: report the failing seed at once instead of shrinking (each run is a game).
      { seed: FC_SEED, numRuns: 8, endOnFailure: true },
    );
    // The random games must actually exercise the special moves.
    expect(total.positions).toBeGreaterThan(600);
    expect(total.castles).toBeGreaterThan(0);
    expect(total.enPassants).toBeGreaterThan(0);
    expect(total.promotions).toBeGreaterThan(0);
  }, 60_000);

  // Illegal-but-parseable positions reach the engine through the Lab, so the same invariants
  // must hold there: king captures, two kings, pawns on back ranks, no kings, many queens.
  it.each([
    '4k3/4R3/8/8/8/8/8/4K3 w - - 0 1',
    'KK6/8/8/8/8/8/8/k7 w - - 0 1',
    'k7/8/8/8/8/8/8/K6P w - - 0 1',
    'k6p/8/8/8/8/8/8/K7 b - - 0 1',
    '8/8/8/8/8/8/8/8 w - - 0 1',
    'k7/8/8/8/8/8/8/7R w - - 0 1',
    'K7/6r1/8/8/8/8/8/4K2R w K - 0 1',
    'qqqqqqqq/8/8/8/8/8/8/k6K b - - 0 1',
    '4k3/8/8/8/8/8/8/4K3 w KQkq e6 0 1',
  ])('the same invariants hold in random play from the illegal position %s', (start) => {
    for (const seed of [1, 2, 3]) checkRandomGame(seed, 40, start);
  });
});
