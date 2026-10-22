import { describe, expect, it } from 'vitest';
import {
  checkers,
  inCheck,
  isSquareAttacked,
  legalMoves,
  squareFromName,
  squareName,
} from '../src/index';
import { fen, ucis, ucisFrom } from './helpers';

const sq = squareFromName;

describe('castling', () => {
  it('both sides when everything allows it', () => {
    const p = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(ucisFrom(p, 'e1')).toEqual(expect.arrayContaining(['e1g1', 'e1c1']));
    const b = fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    expect(ucisFrom(b, 'e8')).toEqual(expect.arrayContaining(['e8g8', 'e8c8']));
  });

  it('not out of check', () => {
    const p = fen('k7/8/8/8/4r3/8/8/R3K2R w KQ - 0 1');
    expect(ucisFrom(p, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(p, 'e1')).not.toContain('e1c1');
  });

  it('not through an attacked square', () => {
    const p = fen('k4r2/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // f1 attacked
    expect(ucisFrom(p, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(p, 'e1')).toContain('e1c1');
  });

  it('not into check', () => {
    const p = fen('k5r1/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // g1 attacked
    expect(ucisFrom(p, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(p, 'e1')).toContain('e1c1');
  });

  it('queenside is allowed when only b1 is attacked', () => {
    const p = fen('kr6/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(ucisFrom(p, 'e1')).toEqual(expect.arrayContaining(['e1c1', 'e1g1']));
  });

  it('not with a piece in the way', () => {
    const p = fen('k7/8/8/8/8/8/8/RN2K1NR w KQ - 0 1');
    expect(ucisFrom(p, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(p, 'e1')).not.toContain('e1c1');
  });

  it('only with the right in the flags', () => {
    const p = fen('k7/8/8/8/8/8/8/R3K2R w Q - 0 1');
    expect(ucisFrom(p, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(p, 'e1')).toContain('e1c1');
  });

  it('never when king or rook is off its home square, whatever the flags say', () => {
    expect(ucisFrom(fen('k7/8/8/8/8/8/8/R4K1R w KQ - 0 1'), 'f1')).not.toContain('f1h1');
    expect(ucisFrom(fen('k7/8/8/8/8/8/8/4K3 w KQ - 0 1'), 'e1')).toEqual([
      'e1d1',
      'e1d2',
      'e1e2',
      'e1f1',
      'e1f2',
    ]);
    const wrongPiece = fen('k7/8/8/8/8/8/8/N3K2B w KQ - 0 1'); // knight a1, bishop h1
    expect(ucisFrom(wrongPiece, 'e1')).not.toContain('e1g1');
    expect(ucisFrom(wrongPiece, 'e1')).not.toContain('e1c1');
  });
});

describe('en passant', () => {
  it('captures right after a double push', () => {
    const p = fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(ucisFrom(p, 'e5')).toEqual(['e5d6', 'e5e6']);
  });

  it('is illegal when it would expose the king along the rank (horizontal pin)', () => {
    // King a5, pawns b5 (white) and c5 (black, just played c7-c5), rook h5.
    const pinned = fen('7k/8/8/KPp4r/8/8/8/8 w - c6 0 1');
    expect(ucisFrom(pinned, 'b5')).toEqual(['b5b6']);
    const free = fen('7k/8/8/KPp5/8/8/8/8 w - c6 0 1');
    expect(ucisFrom(free, 'b5')).toEqual(['b5b6', 'b5c6']);
  });

  it('can remove a checking pawn', () => {
    // Black just played d7-d5 with check; exd6 e.p. removes the checker.
    const p = fen('8/8/8/3pP3/4K3/8/8/7k w - d6 0 1');
    expect(inCheck(p)).toBe(true);
    expect(ucis(p)).toContain('e5d6');
  });

  it('ignores an en passant square with no pawn to capture', () => {
    const p = fen('4k3/8/8/8/8/8/8/4K3 w - e6 0 1');
    expect(ucis(p)).toEqual(['e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2']);
  });

  it('works for black too', () => {
    const p = fen('4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1');
    expect(ucisFrom(p, 'e4')).toEqual(['e4d3', 'e4e3']);
  });
});

describe('promotions and pawns', () => {
  it('promotes to all four pieces, by push and by capture', () => {
    const p = fen('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(ucisFrom(p, 'b7')).toEqual([
      'b7a8b',
      'b7a8n',
      'b7a8q',
      'b7a8r',
      'b7b8b',
      'b7b8n',
      'b7b8q',
      'b7b8r',
    ]);
  });

  it('double pushes only from the start rank and only through an empty square', () => {
    expect(ucisFrom(fen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 'e2')).toEqual(['e2e3', 'e2e4']);
    expect(ucisFrom(fen('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1'), 'e3')).toEqual(['e3e4']);
    expect(ucisFrom(fen('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1'), 'e2')).toEqual([]);
    expect(ucisFrom(fen('4k3/8/8/8/4n3/8/4P3/4K3 w - - 0 1'), 'e2')).toEqual(['e2e3']);
  });
});

describe('pins and checks', () => {
  it('a pinned knight cannot move', () => {
    expect(ucisFrom(fen('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1'), 'e2')).toEqual([]);
  });

  it('a pinned rook can move along the pin line', () => {
    expect(ucisFrom(fen('4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1'), 'e2')).toEqual([
      'e2e3',
      'e2e4',
      'e2e5',
      'e2e6',
      'e2e7',
    ]);
  });

  it('only king moves answer a double check', () => {
    // Rook e8 and bishop b4 both check the king on e1. The rook on a2 could block either
    // line alone (a2-e2 or a2-d2), but not both, so it must not move.
    const p = fen('4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1');
    expect(checkers(p).map(squareName).sort()).toEqual(['b4', 'e8']);
    expect(ucis(p).length).toBeGreaterThan(0);
    expect(ucis(p).every((u) => u.startsWith('e1'))).toBe(true);
  });

  it('reports checkers and attacked squares', () => {
    const p = fen('4k3/8/8/8/8/8/8/R3K3 b - - 0 1');
    expect(inCheck(p)).toBe(false);
    expect(checkers(p)).toEqual([]);
    expect(isSquareAttacked(p, sq('a8'), 'w')).toBe(true);
    expect(isSquareAttacked(p, sq('d2'), 'w')).toBe(true); // king e1
    expect(isSquareAttacked(p, sq('h8'), 'w')).toBe(false);
    const q = fen('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1');
    expect(checkers(q).map(squareName)).toEqual(['e1']);
  });

  it('checkmate and stalemate positions have no legal moves', () => {
    expect(ucis(fen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'))).toEqual([]); // back-rank mate
    expect(ucis(fen('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1'))).toEqual([]); // stalemate
  });
});

describe('robustness on illegal positions', () => {
  it.each([
    '8/8/8/8/8/8/8/8 w - - 0 1',
    'KK6/8/8/8/8/8/8/k7 w - - 0 1',
    'k7/8/8/8/8/8/8/K6P w - - 0 1',
    'k6p/8/8/8/8/8/8/K7 b - - 0 1',
    'P7/8/8/8/8/8/8/K6k w - - 0 1',
    '4k3/4R3/8/8/8/8/8/4K3 w KQkq e6 0 1',
    'QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/8/8/8/k6K w - - 0 1',
    'qqqqqqqq/qqqqqqqq/qqqqqqqq/qqqqqqqq/8/8/8/k6K b - - 0 1',
  ])('generates moves without throwing for %s', (text) => {
    const p = fen(text);
    expect(() => legalMoves(p)).not.toThrow();
  });

  it('never castles into an attacked square, even with two kings of one colour', () => {
    // The legality filter tracks one king per side; castling checks its own destination.
    expect(ucis(fen('K7/6r1/8/8/8/8/8/4K2R w K - 0 1'))).not.toContain('e1g1');
  });

  it('isSquareAttacked is false for an invalid square', () => {
    expect(isSquareAttacked(fen('k7/8/8/8/8/8/B7/7K w - - 0 1'), -1, 'w')).toBe(false);
    expect(isSquareAttacked(fen('k7/8/8/8/8/8/B7/7K w - - 0 1'), 8, 'w')).toBe(false);
  });

  it('a side without a king can still move its pieces', () => {
    expect(ucis(fen('k7/8/8/8/8/8/8/7R w - - 0 1'))).toHaveLength(14);
  });
});
