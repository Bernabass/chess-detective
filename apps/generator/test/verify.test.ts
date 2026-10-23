import { targetKey } from '@retrograde/engine';
import { describe, expect, it } from 'vitest';
import { replayMoves } from '../src/beam';
import { hasTransposedLastMove, verifyCandidate } from '../src/verify';
import { checkFourPlyTargets } from './brute-force';

const target = (moves: string): string => targetKey(replayMoves(moves.split(' ')));
const LIMIT = 1_000_000;

describe('verifyCandidate', () => {
  it('accepts a unique shortest proof game', () => {
    // 1.Nf3 Nf6: no other 2-ply game reaches this position.
    const v = verifyCandidate(target('g1f3 g8f6'), 2, LIMIT);
    expect(v.status).toBe('accepted');
    expect(v.solverNodes).toBeGreaterThan(0);
  });

  it('rejects a target two games reach', () => {
    // 1.e4 e5 2.Nf3 and 1.Nf3 e5 2.e4 reach the same position.
    expect(verifyCandidate(target('e2e4 e7e5 g1f3'), 3, LIMIT).status).toBe('not-unique');
  });

  it('rejects a target a shorter game reaches', () => {
    // 1.a3 a6 2.a4 a5 is the only 4-ply game to its position, but 1.a4 a5 gets there in 2.
    expect(verifyCandidate(target('a2a3 a7a6 a3a4 a6a5'), 4, LIMIT).status).toBe('not-shortest');
  });

  it('reports a node limit instead of a verdict', () => {
    const v = verifyCandidate(target('e2e4 d7d5 e4d5 g8f6 b1c3 f6d5 c3d5 d8d5'), 8, 10);
    expect(v.status).toBe('limit');
  });

  it('gives the same verdict with and without the transposition pre-check', () => {
    for (const game of [
      'e2e4 e7e5 g1f3',
      'g1f3 g8f6',
      'e2e4 d7d5 e4d5 d8d5',
      'e2e4 e7e5 d1h5 b8c6 h5f7',
    ]) {
      const moves = game.split(' ');
      const t = target(game);
      expect(verifyCandidate(t, moves.length, LIMIT, moves).status).toBe(
        verifyCandidate(t, moves.length, LIMIT).status,
      );
    }
  });
});

describe('hasTransposedLastMove', () => {
  it('finds a last move that could have been played a turn earlier', () => {
    expect(hasTransposedLastMove('e2e4 e7e5 g1f3'.split(' '), target('e2e4 e7e5 g1f3'))).toBe(true);
  });

  it('keeps each side moving on its own turns', () => {
    // 1.e4 e5 2.d4 Nf6 -> 1.e4 Nf6 2.d4 e5: Black's moves swap, White's stay where they were.
    expect(
      hasTransposedLastMove('e2e4 e7e5 d2d4 g8f6'.split(' '), target('e2e4 e7e5 d2d4 g8f6')),
    ).toBe(true);
  });

  it('does not fire when the last move depends on the previous one', () => {
    // Qxd5 needs ...d5 and exd5 first.
    expect(
      hasTransposedLastMove('e2e4 d7d5 e4d5 d8d5'.split(' '), target('e2e4 d7d5 e4d5 d8d5')),
    ).toBe(false);
    expect(hasTransposedLastMove([], target('e2e4'))).toBe(false);
  });
});

describe('verifyCandidate against brute force', () => {
  it('accepts exactly the 4-ply targets with one 4-ply game and none in 2 plies (every 600th)', () => {
    // Every 30th target in the slow suite.
    const { checked, accepted } = checkFourPlyTargets(600);
    expect(checked).toBeGreaterThan(110);
    expect(accepted).toBeGreaterThan(5);
  }, 60_000);
});
