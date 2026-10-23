import { describe, expect, it } from 'vitest';
import { diagramStatistics } from './solver-shared';

// External check (DECISIONS 2026-10-22, Phase 4): wismuth.com/chess/statistics-positions.html,
// diagram table. A "diagram" there is the 64 squares only; with exactly N plies from the start
// the side to move is fixed by parity, so per N it is our target key. "Uniquely realizable" =
// exactly one N-ply game reaches it (no shortest requirement). N = 4 and 5 are in the slow suite.
const ALL = [1, 20, 400, 5362];
const UNIQUELY_REALIZABLE = [1, 20, 400, 1862];
// Ours also requires "no shorter game"; at these lengths that changes nothing.
const UNIQUE_SHORTEST = [1, 20, 400, 1862];

describe('brute-force diagram statistics match wismuth.com (N <= 3)', () => {
  it('distinct diagrams and uniquely realizable diagrams per ply', () => {
    const stats = diagramStatistics(3);
    expect(stats.map((s) => s.all)).toEqual(ALL);
    expect(stats.map((s) => s.uniquelyRealizable)).toEqual(UNIQUELY_REALIZABLE);
    expect(stats.map((s) => s.uniqueShortest)).toEqual(UNIQUE_SHORTEST);
  }, 60_000);
});
