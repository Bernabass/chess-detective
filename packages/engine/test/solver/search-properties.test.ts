import { describe, expect, it } from 'vitest';
import { shortestProofGame, solveProofGame } from '../../src/index';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

// Heavier search checks, run without coverage instrumentation (see the engine's test script).
describe('solveProofGame under stress', () => {
  it('gives the same counts with a tiny transposition table (heavy replacement)', () => {
    const big = solveProofGame(START, { plies: 8, mode: 'count', ttBits: 16 });
    const tiny = solveProofGame(START, { plies: 8, mode: 'count', ttBits: 4 });
    expect(big.count).toBe(2700);
    expect(tiny.count).toBe(2700);
    expect(tiny.nodes).toBeGreaterThan(big.nodes); // the table really saves work
  });

  it('honours a short time budget closely, also across the lengths shortestProofGame tries', () => {
    const t0 = Date.now();
    const r = solveProofGame(START, { plies: 12, mode: 'find-all', ttBits: 4, timeLimitMs: 100 });
    expect(r.status).toBe('limit');
    expect(Date.now() - t0).toBeLessThan(400);
    const t1 = Date.now();
    const s = shortestProofGame('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b', 15, {
      timeLimitMs: 100,
    });
    expect(s.status).toBe('limit');
    expect(Date.now() - t1).toBeLessThan(400);
  });

  it('stops at limits, never claiming more than it searched', () => {
    const limited = solveProofGame(START, { plies: 10, mode: 'count', ttBits: 4, nodeLimit: 1000 });
    expect(limited.status).toBe('limit');
    expect(limited.nodes).toBeLessThanOrEqual(1001);

    // A 10-ply count with a tiny table passes the 4,096-node limit check.
    const aborted = solveProofGame(START, {
      plies: 10,
      mode: 'count',
      ttBits: 4,
      shouldStop: () => true,
    });
    expect(aborted.status).toBe('aborted');
    expect(aborted.nodes).toBeLessThan(5000);

    const timed = solveProofGame(START, { plies: 10, mode: 'count', ttBits: 4, timeLimitMs: 0 });
    expect(timed.status).toBe('limit');
  });
});
