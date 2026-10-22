import { describe, expect, it } from 'vitest';
import { squareFromName as sq } from '../../src/index';
import { WHITE, BLACK } from '../../src/core/board';
import { createLowerBound } from '../../src/solver/bound';
import {
  K_KING,
  K_LIGHT_BISHOP,
  K_ROOK,
  knightDistance,
  obstacleDistance,
  parseTarget,
  pawnDistance,
  rookDistance,
  type Target,
} from '../../src/solver/target';
import { fen } from '../helpers';

function target(key: string): Target {
  const r = parseTarget(key);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function bound(position: string, key: string) {
  return createLowerBound(target(key))(fen(position));
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parseTarget', () => {
  it('accepts a target key and rejects anything else', () => {
    expect(parseTarget('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b').ok).toBe(true);
    expect(parseTarget('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR').ok).toBe(false);
    expect(parseTarget(START).ok).toBe(false);
    expect(parseTarget('8/8/8/8/8/8/8/9 w').ok).toBe(false);
  });
});

describe('empty-board distances (SPEC §6.3)', () => {
  it('pawn costs allow a double push before a file change', () => {
    expect(pawnDistance(WHITE, sq('e2'), sq('e4'))).toBe(1);
    expect(pawnDistance(WHITE, sq('e2'), sq('e5'))).toBe(2);
    expect(pawnDistance(WHITE, sq('e2'), sq('f5'))).toBe(2); // e4, exf5: not 3
    expect(pawnDistance(WHITE, sq('e2'), sq('g4'))).toBe(2); // two captures, no double push
    expect(pawnDistance(WHITE, sq('e3'), sq('e5'))).toBe(2); // no double push off rank 3
    expect(pawnDistance(WHITE, sq('e2'), sq('e2'))).toBe(0);
    expect(pawnDistance(WHITE, sq('e4'), sq('e3'))).toBe(Infinity);
    expect(pawnDistance(WHITE, sq('e2'), sq('h4'))).toBe(Infinity);
    expect(pawnDistance(BLACK, sq('e7'), sq('f4'))).toBe(2); // ...e5, ...exf4
    expect(pawnDistance(BLACK, sq('e7'), sq('e8'))).toBe(Infinity);
  });

  it('knight distances come from a BFS table', () => {
    expect(knightDistance(sq('b1'), sq('c3'))).toBe(1);
    expect(knightDistance(sq('b1'), sq('d4'))).toBe(3);
    expect(knightDistance(sq('a1'), sq('b2'))).toBe(4);
    expect(knightDistance(sq('a1'), sq('h8'))).toBe(6);
  });
});

describe('frozen-pawn distances', () => {
  it('route pieces around target pawns that never left their starting square', () => {
    // Every white pawn at home except b2: a2 is frozen, so the a1 rook goes round by b1 and b3.
    const t = target('rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR b');
    expect(rookDistance(sq('a1'), sq('a3'))).toBe(1);
    expect(obstacleDistance(t, K_ROOK, WHITE, sq('a1'), sq('a3'))).toBe(3);
    // The f1 bishop is shut in by e2 and g2.
    expect(obstacleDistance(t, K_LIGHT_BISHOP, WHITE, sq('f1'), sq('c4'))).toBe(Infinity);
    // A frozen pawn's own square can't be anyone's destination, and other pieces are no obstacle.
    expect(obstacleDistance(t, K_KING, WHITE, sq('e1'), sq('e2'))).toBe(Infinity);
    expect(obstacleDistance(t, K_ROOK, WHITE, sq('h1'), sq('h1'))).toBe(0);
  });

  it('make the bound see a locked-in piece', () => {
    // The target needs the f1 bishop on c4 while e2 and g2 never moved: impossible.
    expect(bound(START, 'rnbqkbnr/pppppppp/8/8/2B5/8/PPPPPPPP/RNBQK1NR w')).toBeNull();
  });
});

describe('lowerBound', () => {
  it('is zero at the target and counts the moves still needed', () => {
    expect(bound(START, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')).toEqual({
      white: 0,
      black: 0,
    });
    expect(bound(START, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w')).toEqual({
      white: 1,
      black: 1,
    });
  });

  it('counts captures a side must make', () => {
    // Black must capture two white pieces: at least 2 black moves even if nothing else moves.
    expect(bound(START, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBNR w')?.black).toBe(1);
    expect(bound(START, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKB1R w')?.black).toBe(2);
  });

  it('handles the castling trap: castling is one move for king and rook together', () => {
    const before = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const after = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b';
    expect(bound(before, after)?.white).toBe(1);
    // Without the right, the king and rook really need 2 + 1 moves.
    expect(bound(before.replace('KQkq', 'kq'), after)?.white).toBe(3);
  });

  it('lets a target piece be a promoted pawn instead of forcing a match (DECISIONS 2026-10-22)', () => {
    // 1.g8=N Rxa1: White's far-away knight is captured, the target knight is the promoted
    // pawn. White needs 1 move; a forced knight-to-knight match would say a1-g8, 4 or more.
    const before = 'k7/6P1/8/8/8/8/r7/N3K3 w - - 0 1';
    const after = 'k5N1/8/8/8/8/8/8/r3K3 w';
    expect(knightDistance(sq('a1'), sq('g8'))).toBeGreaterThan(1);
    expect(bound(before, after)).toEqual({ white: 0, black: 1 });
  });

  it('allows at most E promotions per type, E = current pawns - target pawns', () => {
    // Two target knights far away, one pawn to spare: one knight may be promoted, the other
    // must be matched to the current knight.
    const b = bound('k7/6P1/8/8/8/8/8/N3K3 w - - 0 1', 'k5N1/8/8/8/8/8/8/4K2N w');
    expect(b?.white).toBe(
      Math.min(knightDistance(sq('a1'), sq('h1')), knightDistance(sq('a1'), sq('g8'))),
    );
  });

  it('detects impossible targets', () => {
    // More white pieces in the target than now.
    expect(bound('4k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/3QK3 w')).toBeNull();
    // A target pawn behind every current pawn.
    expect(bound('4k3/8/8/8/4P3/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/4P3/8/4K3 w')).toBeNull();
    // A second dark-squared bishop with every pawn still needed: no promotion possible.
    expect(bound(START, 'rnbqkbnr/pppppppp/8/8/8/4B3/PPPPPPPP/RNBQK1NR w')).toBeNull();
    // A target piece needing promotion, with no pawn to spare.
    expect(bound('4k3/8/8/8/8/8/P7/4K3 w - - 0 1', '4k3/8/8/8/8/8/P7/3QK3 w')).toBeNull();
  });
});
