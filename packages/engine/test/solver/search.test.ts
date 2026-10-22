import { describe, expect, it } from 'vitest';
import { replay, shortestProofGame, solveProofGame, targetKey } from '../../src/index';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const START_BLACK = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w';

describe('solveProofGame', () => {
  it('counts games back to the start: knights out and home, and parity', () => {
    expect(solveProofGame(START, { plies: 4, mode: 'count' }).count).toBe(16);
    // Each side would need an odd number of moves to come home: impossible.
    expect(solveProofGame(START, { plies: 6, mode: 'count' }).count).toBe(0);
  });

  it('find-one returns one proof; find-all collects distinct proofs up to cap', () => {
    const one = solveProofGame(AFTER_E4_E5, { plies: 2, mode: 'find-one' });
    expect(one.solutions).toEqual([['e2e4', 'e7e5']]);
    const all = solveProofGame(START, { plies: 4, mode: 'find-all', cap: 5 });
    expect(all.solutions).toHaveLength(5);
    expect(new Set(all.solutions.map((s) => s.join(' '))).size).toBe(5);
    for (const s of all.solutions) {
      const r = replay(s);
      expect(r.ok && targetKey(r.value)).toBe(START);
    }
    expect(solveProofGame(START, { plies: 4, mode: 'find-all' }).solutions).toHaveLength(16);
  });

  it('count saturates at cap', () => {
    const r = solveProofGame(START, { plies: 8, mode: 'count', cap: 2 });
    expect(r).toMatchObject({ status: 'complete', count: 2 });
  });

  it('returns 0 at once when the side to move has the wrong parity for the length', () => {
    expect(solveProofGame(AFTER_E4, { plies: 2, mode: 'count' })).toMatchObject({
      count: 0,
      status: 'complete',
    });
  });

  it('honours required castling rights and en passant square', () => {
    const free = solveProofGame(AFTER_E4_E5, { plies: 6, mode: 'count' }).count;
    const keepRights = solveProofGame(AFTER_E4_E5, {
      plies: 6,
      mode: 'count',
      castling: 'KQkq',
    }).count;
    expect(keepRights).toBeGreaterThan(0);
    expect(keepRights).toBeLessThan(free); // no king walks like Ke2-e1
    const anyEp = solveProofGame(AFTER_E4, { plies: 5, mode: 'count' }).count;
    const e3 = solveProofGame(AFTER_E4, { plies: 5, mode: 'count', enPassant: 'e3' });
    expect(e3.count).toBeGreaterThan(0);
    expect(e3.count).toBeLessThan(anyEp); // the last move must be e2-e4
  });

  it('rejects a malformed target', () => {
    expect(() => solveProofGame('not a target', { plies: 2, mode: 'count' })).toThrow();
  });
});

describe('shortestProofGame', () => {
  it('finds the shortest proof, starting from the lower bound and the right parity', () => {
    expect(shortestProofGame(AFTER_E4_E5, 10)).toMatchObject({
      status: 'complete',
      plies: 2,
      solution: ['e2e4', 'e7e5'],
      searched: [],
    });
    expect(shortestProofGame(AFTER_E4, 10)).toMatchObject({ plies: 1, solution: ['e2e4'] });
    expect(shortestProofGame(START, 10)).toMatchObject({ plies: 0, solution: [] });
  });

  it('reports "none up to maxPlies" after searching every length of the right parity', () => {
    // The start position with Black to move is unreachable (knight parity).
    expect(shortestProofGame(START_BLACK, 5)).toMatchObject({
      status: 'complete',
      solution: null,
      searched: [1, 3, 5],
    });
    // Below the lower bound nothing is searched at all.
    expect(shortestProofGame(AFTER_E4_E5, 1)).toMatchObject({ solution: null, searched: [] });
  });

  it('knows an unreachable target at once', () => {
    // A second dark-squared bishop with every pawn still at home.
    const r = shortestProofGame('rnbqkbnr/pppppppp/8/8/8/4B3/PPPPPPPP/RNBQK1NR w', 20);
    expect(r).toMatchObject({ status: 'complete', solution: null, searched: [] });
    expect(r.nodes).toBe(0);
  });

  it('shares limits across the lengths it tries', () => {
    const r = shortestProofGame(START_BLACK, 15, { nodeLimit: 2000 });
    expect(r.status).toBe('limit');
    expect(r.nodes).toBeLessThanOrEqual(2001);
  });
});
