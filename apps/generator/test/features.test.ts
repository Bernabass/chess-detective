import { describe, expect, it } from 'vitest';
import { assignStars, difficultyScore } from '../src/difficulty';
import { countFeatures, featureTags } from '../src/features';
import { describeGame } from '../src/moves';

const features = (moves: string): string[] =>
  featureTags(countFeatures(describeGame(moves.split(' '))));

describe('countFeatures', () => {
  it('finds nothing in a plain opening', () => {
    expect(features('e2e4 e7e5 g1f3')).toEqual([]);
  });

  it('counts captures, including en passant', () => {
    const c = countFeatures(describeGame('e2e4 d7d5 e4d5 c7c5 d5c6'.split(' ')));
    expect(c.captures).toBe(2);
    expect(c.enPassant).toBe(1);
    expect(featureTags(c)).toEqual(['capture', 'en-passant']);
  });

  it('tells a tempo (straight back) from a switchback (back by another way)', () => {
    // Nf3, Ng1: an immediate back-and-forth.
    expect(features('g1f3 e7e5 f3g1')).toEqual(['tempo']);
    // Bc4, Be2, Bf1: back to f1 by way of two other squares.
    expect(features('e2e4 a7a6 f1c4 a6a5 c4e2 a5a4 e2f1')).toEqual(['switchback']);
  });

  it('follows the piece, not the square', () => {
    // The g1 knight leaves f3 for h4; the b1 knight then arrives on f3 by c3, e4, g5.
    expect(features('g1f3 a7a6 f3h4 a6a5 b1c3 a5a4 c3e4 h7h6 e4g5 h6h5 g5f3')).toEqual([]);
  });

  it('tracks the rook when castling', () => {
    // After O-O the rook stands on f1: Re1 and Rf1 are a back-and-forth of that rook.
    const c = countFeatures(
      describeGame('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1 a7a6 f1e1 a6a5 e1f1'.split(' ')),
    );
    expect(c.castling).toBe(1);
    expect(c.tempo).toBe(1);
    expect(c.switchbacks).toBe(0);
    expect(c.kingMoves).toBe(0);
  });

  it('counts king moves (not castling) for king-walk', () => {
    expect(features('e2e4 e7e5 e1e2 a7a6 e2d3')).toEqual(['king-walk']);
    expect(features('e2e4 e7e5 e1e2')).toEqual([]);
    // One move by each king is not a walk.
    expect(features('e2e4 e7e5 e1e2 e8e7')).toEqual([]);
  });

  it('detects promotion, underpromotion and phoenix', () => {
    // White's a-pawn captures its way to a8 and promotes to a knight. Only black pieces were
    // captured, so it is not a phoenix.
    const run = 'a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 b8c6 b7a8n';
    expect(features(run)).toEqual(['capture', 'promotion', 'underpromotion']);
    // White's own queen is captured, then a pawn promotes to a queen: a phoenix.
    const phoenix = 'e2e4 d7d5 d1h5 g8f6 h5f7 e8f7 e4d5 f7g6 d5d6 g6f5 d6c7 f5e6 c7b8q';
    const c = countFeatures(describeGame(phoenix.split(' ')));
    expect(c.phoenix).toBe(1);
    expect(featureTags(c)).toContain('phoenix');
  });
});

describe('difficultyScore', () => {
  it('follows the SPEC §7.3 formula', () => {
    const c = countFeatures(describeGame('e2e4 d7d5 e4d5 c7c5 d5c6'.split(' ')));
    // 5 + 1.5*2 + 3*1 + log2(256)/4 = 13
    expect(difficultyScore(5, c, 256)).toBe(13);
    expect(difficultyScore(5, countFeatures([]), 1)).toBe(5);
  });
});

describe('assignStars', () => {
  it('cuts the ranks at 1/7, 3/7, 5/7 and 6/7', () => {
    const items = Array.from({ length: 70 }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`,
      score: i,
    }));
    const stars = assignStars(items);
    const count = (s: number): number => stars.filter((x) => x === s).length;
    expect([1, 2, 3, 4, 5].map(count)).toEqual([10, 20, 20, 10, 10]);
    expect(stars[0]).toBe(1);
    expect(stars[69]).toBe(5);
  });

  it('breaks ties by id, whatever the input order', () => {
    const items = [
      { id: 'b', score: 1 },
      { id: 'a', score: 1 },
      { id: 'c', score: 1 },
      { id: 'd', score: 1 },
      { id: 'e', score: 1 },
      { id: 'f', score: 1 },
      { id: 'g', score: 1 },
    ];
    const stars = assignStars(items);
    expect(stars[1]).toBe(1); // 'a' ranks first
    const byId = new Map(items.map((item, i) => [item.id, stars[i]]));
    const reversed = [...items].reverse();
    const again = assignStars(reversed);
    reversed.forEach((item, i) => {
      expect(again[i]).toBe(byId.get(item.id));
    });
  });
});
