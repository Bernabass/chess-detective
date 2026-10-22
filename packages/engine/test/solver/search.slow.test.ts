import { describe, expect, it } from 'vitest';
import { solveProofGame } from '../../src/index';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

describe('solveProofGame progress (slow: needs 100,000+ nodes)', () => {
  it('reports progress about every 50,000 nodes', () => {
    const progress: number[] = [];
    solveProofGame(START, {
      plies: 12,
      mode: 'count',
      ttBits: 4,
      nodeLimit: 120_000,
      onProgress: (p) => progress.push(p.nodes),
    });
    expect(progress.length).toBe(2);
    expect(progress[0]).toBeGreaterThanOrEqual(50_000);
    expect(progress[1]).toBeGreaterThanOrEqual(100_000);
  });
});
