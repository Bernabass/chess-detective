import { describe, expect, it } from 'vitest';
import { isSwitchback, plainKingWalk, runBeam, selectFrontier, type BeamNode } from '../src/beam';
import { describeGame } from '../src/moves';
import { inlineVerifier } from '../src/workers';

function node(index: number, parent: number, moves: string, score: number): BeamNode {
  return {
    verified: {
      candidate: { index, moves: moves.split(' '), target: '', source: 'beam' },
      verification: { status: 'accepted', nodes: 0, solverNodes: 0 },
      elapsedMs: 0,
    },
    infos: [],
    parent,
    score,
  };
}

describe('runBeam', () => {
  it('keeps the frontier spread over many openings', async () => {
    const width = 30;
    const accepted = await runBeam({
      seed: 5,
      width,
      children: 4,
      maxPlies: 3,
      verifier: inlineVerifier(200_000).verify,
    });
    const at = (n: number): BeamNode[] =>
      accepted.filter((a) => a.verified.candidate.moves.length === n);
    // Every first move is unique, and all 20 are verified while the frontier is small.
    expect(at(1)).toHaveLength(20);
    const firstMoves = new Set(at(3).map((a) => a.verified.candidate.moves[0]));
    expect(firstMoves.size).toBeGreaterThanOrEqual(width / Math.floor(width / 6));
  }, 60_000);
});

describe('selectFrontier', () => {
  it('caps children per parent, scaled to the number of parents', () => {
    // 10 children of one parent: with one parent, up to width of them are kept.
    const one = Array.from({ length: 10 }, (_, i) => node(i, 7, `a${String(i)}`, 10 - i));
    expect(selectFrontier(one, 6)).toHaveLength(6);
    // 3 parents x 10 children, width 6: at most max(3, 6/3) = 3 per parent, best first.
    const three = [0, 1, 2].flatMap((p) =>
      Array.from({ length: 10 }, (_, i) =>
        node(p * 10 + i, p, `p${String(p)}c${String(i)}`, 10 - i + p),
      ),
    );
    const chosen = selectFrontier(three, 9);
    for (const p of [0, 1, 2]) expect(chosen.filter((n) => n.parent === p)).toHaveLength(3);
  });

  it('keeps at most 2 puzzles sharing a 6-ply prefix', () => {
    const shared = 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6';
    const nodes = Array.from({ length: 8 }, (_, i) => node(i, i, `${shared} m${String(i)}`, 8 - i));
    expect(selectFrontier(nodes, 100).map((n) => n.verified.candidate.index)).toEqual([0, 1]);
  });
});

describe('beam move filters', () => {
  it('spots a plain king walk: the last three moves of the mover are quiet king moves', () => {
    expect(plainKingWalk(describeGame('e2e4 e7e5 e1e2 a7a6 e2d3 a6a5 d3c4'.split(' ')))).toBe(true);
    expect(plainKingWalk(describeGame('e2e4 e7e5 e1e2 a7a6 e2d3 a6a5 b1c3'.split(' ')))).toBe(
      false,
    );
  });

  it('spots a switchback by following the piece back', () => {
    const history = describeGame('g1f3 a7a6 f3h4 a6a5'.split(' '));
    const back = describeGame('g1f3 a7a6 f3h4 a6a5 h4f3'.split(' ')).at(-1);
    if (back === undefined) throw new Error('no move');
    expect(isSwitchback(history, back)).toBe(true);
  });
});
