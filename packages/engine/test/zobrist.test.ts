import { describe, expect, it } from 'vitest';
import {
  initialPosition,
  makeMove,
  toFen,
  uciToMove,
  unmakeMove,
  type Position,
} from '../src/index';
import { computeHash } from '../src/core/zobrist';
import { fen } from './helpers';

function hashOf(p: Position): string {
  return `${p.hashHi.toString(16)}:${p.hashLo.toString(16)}`;
}

function play(p: Position, ...moves: string[]): Position {
  for (const u of moves) {
    const r = uciToMove(p, u);
    if (!r.ok) throw new Error(`${u}: ${r.error}`);
    makeMove(p, r.value);
  }
  return p;
}

describe('zobrist hashing', () => {
  it('is fixed for the start position on every machine', () => {
    // Regression lock: these keys come from the fixed-seed RNG. If they change, every stored
    // hash changes too, so update this only with a DECISIONS.md entry.
    const p = initialPosition();
    expect([p.hashHi, p.hashLo]).toEqual(START_HASH);
  });

  it('stays equal to a from-scratch recomputation through castling, en passant and promotion', () => {
    // Sequence checked with python-chess: O-O-O, O-O, d4, exd3 e.p., bxa8=Q, Rxa8.
    const p = fen('r3k2r/1P6/8/8/4p3/8/3P4/R3K2R w KQkq - 0 1');
    for (const u of ['e1c1', 'e8g8', 'd2d4', 'e4d3', 'b7a8q', 'f8a8']) {
      play(p, u);
      expect(computeHash(p), `after ${u}`).toEqual({ hi: p.hashHi, lo: p.hashLo });
      expect(hashOf(fen(toFen(p))), `parsed after ${u}`).toBe(hashOf(p));
    }
    expect(toFen(p)).toBe('r5k1/8/8/8/8/3p4/8/2KR3R w - - 0 4');
  });

  it('depends on side to move, castling rights and placement', () => {
    const base = hashOf(fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'));
    expect(hashOf(fen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'))).not.toBe(base);
    expect(hashOf(fen('r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1'))).not.toBe(base);
    expect(hashOf(fen('r3k2r/8/8/8/8/8/8/R3K1R1 w KQkq - 0 1'))).not.toBe(base); // placement only
  });

  it('ignores the clocks', () => {
    expect(hashOf(fen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'))).toBe(
      hashOf(fen('4k3/8/8/8/8/8/8/4K3 w - - 37 90')),
    );
  });

  describe('en passant', () => {
    it('ignores an en passant square no pawn can use', () => {
      // After 1.e4 no black pawn stands on d4 or f4.
      const stated = fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
      const unstated = fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
      expect(hashOf(stated)).toBe(hashOf(unstated));
      expect(hashOf(play(initialPosition(), 'e2e4'))).toBe(hashOf(unstated));
    });

    it('includes a usable en passant square', () => {
      const usable = fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
      const none = fen('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1');
      expect(hashOf(usable)).not.toBe(hashOf(none));
    });

    it('counts a pinned capturer as usable (pseudo-legal rule)', () => {
      const pinned = fen('7k/8/8/KPp4r/8/8/8/8 w - c6 0 1');
      const none = fen('7k/8/8/KPp4r/8/8/8/8 w - - 0 1');
      expect(hashOf(pinned)).not.toBe(hashOf(none));
    });

    it('agrees between makeMove and a parsed FEN when the square is usable', () => {
      const played = play(fen('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1'), 'd7d5');
      expect(hashOf(played)).toBe(hashOf(fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2')));
    });
  });

  it('is restored exactly by unmakeMove', () => {
    const p = initialPosition();
    const before = hashOf(p);
    play(p, 'e2e4', 'd7d5', 'e4d5', 'g8f6');
    for (let i = 0; i < 4; i++) unmakeMove(p);
    expect(hashOf(p)).toBe(before);
  });
});

const START_HASH: [number, number] = [2713981909, 3401193927];
