import { describe, expect, it } from 'vitest';
import { legalMoves, moveToSan, moveToUci, sanToMove, uciToMove } from '../src/index';
import { fen } from './helpers';

function sans(text: string): string[] {
  const p = fen(text);
  return legalMoves(p)
    .map((m) => moveToSan(p, m))
    .sort();
}

function sanToUci(text: string, san: string): string {
  const p = fen(text);
  const r = sanToMove(p, san);
  if (!r.ok) throw new Error(`${san}: ${r.error}`);
  return moveToUci(r.value);
}

function sanError(text: string, san: string): string {
  const r = sanToMove(fen(text), san);
  if (r.ok) throw new Error(`expected ${san} to be rejected`);
  return r.error;
}

// Expected SAN lists cross-checked against python-chess 1.11.2.
describe('moveToSan', () => {
  it('disambiguates by file', () => {
    expect(sans('4k3/8/8/8/8/8/8/1N1K1N2 w - - 0 1')).toEqual([
      'Kc1',
      'Kc2',
      'Kd2',
      'Ke1',
      'Ke2',
      'Na3',
      'Nbd2',
      'Nc3',
      'Ne3',
      'Nfd2',
      'Ng3',
      'Nh2',
    ]);
  });

  it('disambiguates by rank', () => {
    expect(sans('4k3/8/8/6N1/8/8/8/3K2N1 w - - 0 1')).toEqual([
      'Kc1',
      'Kc2',
      'Kd2',
      'Ke1',
      'Ke2',
      'N1f3',
      'N1h3',
      'N5f3',
      'N5h3',
      'Ne2',
      'Ne4',
      'Ne6',
      'Nf7',
      'Nh7',
    ]);
  });

  it('disambiguates by file and rank, with checks', () => {
    expect(sans('4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1')).toEqual([
      'Kd1',
      'Kd2',
      'Ke2',
      'Kf1',
      'Kf2',
      'Q1a2',
      'Q3a2',
      'Q3b2',
      'Q3c3',
      'Qa1b2',
      'Qa1c3',
      'Qa4+',
      'Qa5',
      'Qa6',
      'Qa7',
      'Qa8+',
      'Qab1',
      'Qac5',
      'Qae3+',
      'Qb3',
      'Qb4',
      'Qc2',
      'Qc4',
      'Qc6+',
      'Qc7',
      'Qc8+',
      'Qcb1',
      'Qcb2',
      'Qcc3',
      'Qcc5',
      'Qce3+',
      'Qd1',
      'Qd2',
      'Qd3',
      'Qd4',
      'Qd6',
      'Qe5+',
      'Qe7+',
      'Qf3',
      'Qf4',
      'Qf6',
      'Qf8+',
      'Qg3',
      'Qg5',
      'Qg7',
      'Qh3',
      'Qh6',
      'Qh8+',
    ]);
  });

  it('marks checkmate with #', () => {
    expect(sans('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')).toContain('Ra8#');
  });

  it('writes castling, including castling with check', () => {
    expect(sans('5k2/8/8/8/8/8/8/4K2R w K - 0 1')).toEqual([
      'Kd1',
      'Kd2',
      'Ke2',
      'Kf1',
      'Kf2',
      'O-O+',
      'Rf1+',
      'Rg1',
      'Rh2',
      'Rh3',
      'Rh4',
      'Rh5',
      'Rh6',
      'Rh7',
      'Rh8+',
    ]);
    expect(sans('r3k3/8/8/8/8/8/8/4K3 b q - 0 1')).toContain('O-O-O');
  });

  it('writes promotions and pawn captures, including en passant', () => {
    expect(sans('7k/P7/8/8/8/8/8/K7 w - - 0 1')).toEqual([
      'Ka2',
      'Kb1',
      'Kb2',
      'a8=B',
      'a8=N',
      'a8=Q+',
      'a8=R+',
    ]);
    expect(sans('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).toEqual([
      'Kd1',
      'Kd2',
      'Ke2',
      'Kf1',
      'Kf2',
      'e6',
      'exd6',
    ]);
    expect(sans('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')).toEqual(
      expect.arrayContaining(['Bb5+', 'exd5', 'e5', 'Nc3']),
    );
  });
});

describe('sanToMove', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const CASTLE = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const PROMO = 'r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1';

  it('reads standard SAN', () => {
    expect(sanToUci(START, 'Nf3')).toBe('g1f3');
    expect(sanToUci(START, 'e4')).toBe('e2e4');
    expect(sanToUci(CASTLE, 'O-O')).toBe('e1g1');
    expect(sanToUci(CASTLE, 'O-O-O')).toBe('e1c1');
    expect(sanToUci(PROMO, 'bxa8=Q')).toBe('b7a8q');
    expect(sanToUci('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'exd6')).toBe('e5d6');
  });

  it('is lenient about check marks, zeros, case, annotations and missing x', () => {
    expect(sanToUci(START, 'Nf3+')).toBe('g1f3');
    expect(sanToUci(START, 'Nf3!?')).toBe('g1f3');
    expect(sanToUci(CASTLE, '0-0')).toBe('e1g1');
    expect(sanToUci(CASTLE, '0-0-0+')).toBe('e1c1');
    expect(sanToUci(CASTLE, 'o-o')).toBe('e1g1');
    expect(sanToUci(PROMO, 'b8=q')).toBe('b7b8q');
    expect(sanToUci(PROMO, 'b8q')).toBe('b7b8q');
    expect(sanToUci(PROMO, 'b8N')).toBe('b7b8n');
    expect(sanToUci(PROMO, 'ba8=R')).toBe('b7a8r');
    expect(sanToUci(START, 'Ng1f3')).toBe('g1f3');
    expect(sanToUci('4k3/8/8/8/8/8/8/1N1K1N2 w - - 0 1', 'Nbd2')).toBe('b1d2');
    expect(sanToUci('4k3/8/8/6N1/8/8/8/3K2N1 w - - 0 1', 'N5f3')).toBe('g5f3');
  });

  it('round-trips with moveToSan for every legal move', () => {
    for (const text of [START, CASTLE, PROMO, '4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1']) {
      const p = fen(text);
      for (const m of legalMoves(p)) {
        const r = sanToMove(p, moveToSan(p, m));
        expect(r.ok && r.value).toBe(m);
      }
    }
  });

  it('rejects ambiguous, illegal, incomplete and malformed SAN', () => {
    expect(sanError('4k3/8/8/8/8/8/8/1N1K1N2 w - - 0 1', 'Nd2')).toMatch(/ambiguous/i);
    expect(sanError(START, 'Ke2')).toMatch(/illegal/i);
    expect(sanError(START, 'e5')).toMatch(/illegal/i);
    expect(sanError(PROMO, 'b8')).toMatch(/promotion/i);
    expect(sanError(START, 'Zf3')).toMatch(/not valid SAN/i);
    expect(sanError(START, '')).toMatch(/not valid SAN/i);
    expect(sanError(START, 'O-O')).toMatch(/illegal/i);
    expect(sanError(START, 'Nf3=Q')).toMatch(/illegal/i);
  });

  it('rejects a capture mark on a move that captures nothing', () => {
    expect(sanError(START, 'Nxf3')).toMatch(/illegal/i);
    expect(sanError(START, 'exe4')).toMatch(/illegal/i);
  });

  it('does not treat a plain pawn push as a capture', () => {
    // "d5" must not be read as exd5 just because e4 can capture there.
    expect(sanError('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'd5')).toMatch(/illegal/i);
  });
});

describe('UCI', () => {
  it('converts both ways, including castling and promotion', () => {
    const p = fen('r3k3/1P6/8/8/8/8/8/R3K2R w KQ - 0 1');
    for (const u of ['e1g1', 'e1c1', 'b7a8n', 'b7b8q', 'a1a7']) {
      const r = uciToMove(p, u);
      expect(r.ok && moveToUci(r.value)).toBe(u);
    }
  });

  it('rejects malformed, illegal and incomplete UCI', () => {
    const p = fen('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const error = (u: string) => {
      const r = uciToMove(p, u);
      return r.ok ? '' : r.error;
    };
    expect(error('e2e4')).toMatch(/illegal/i);
    expect(error('b7b8')).toMatch(/promotion/i);
    expect(error('e1e2q')).toMatch(/illegal/i);
    expect(error('E1E2')).toMatch(/malformed/i);
    expect(error('e1e9')).toMatch(/malformed/i);
    expect(error('e1')).toMatch(/malformed/i);
    expect(error('b7b8k')).toMatch(/malformed/i);
  });
});
