import { describe, expect, it } from 'vitest';
import { diagramStatistics } from './solver-shared';

// External check (DECISIONS 2026-10-22, Phase 4): wismuth.com/chess/statistics-positions.html,
// diagram table. A "diagram" there is the 64 squares only; with exactly N plies from the start
// the side to move is fixed by parity, so per N it is our target key. "Uniquely realizable" =
// exactly one N-ply game reaches it (no shortest requirement).
const ALL = [1, 20, 400, 5362, 71852];
const UNIQUELY_REALIZABLE = [1, 20, 400, 1862, 9373];
// Ours: also no shorter game. At N = 4, 64 targets are reached by exactly one 4-ply game but also
// in 2 plies (1.a3 a6 2.a4 a5 is the only 4-ply game, but 1.a4 a5 is shorter).
const UNIQUE_SHORTEST = [1, 20, 400, 1862, 9309];

describe('brute-force diagram statistics match wismuth.com (N <= 4)', () => {
  it('distinct diagrams and uniquely realizable diagrams per ply', () => {
    const stats = diagramStatistics(4);
    expect(stats.map((s) => s.all)).toEqual(ALL);
    expect(stats.map((s) => s.uniquelyRealizable)).toEqual(UNIQUELY_REALIZABLE);
    expect(stats.map((s) => s.uniqueShortest)).toEqual(UNIQUE_SHORTEST);
  }, 120_000);
});
