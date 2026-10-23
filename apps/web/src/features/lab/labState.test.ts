// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  START,
  fromFen,
  labPath,
  lichessEditorUrl,
  normalizeCastling,
  parseError,
  toFenString,
} from './labState';

describe('Lab state', () => {
  it('round-trips a full FEN (clocks become "0 1")', () => {
    const f = fromFen('r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 4 4');
    expect(f).toEqual({
      placement: 'r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1',
      side: 'b',
      castling: 'kq',
      enPassant: '',
    });
    if (f === null) return;
    expect(toFenString(f)).toBe('r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 0 1');
  });

  it('forgives missing trailing fields', () => {
    expect(fromFen('k7/8/8/8/8/8/8/K7')).toMatchObject({ side: 'w', castling: '', enPassant: '' });
    expect(fromFen('  k7/8/8/8/8/8/8/K7   b  ')).toMatchObject({ side: 'b' });
  });

  it('explains an invalid FEN with the engine message', () => {
    expect(parseError('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w')).toMatch(/rank|square|8/i);
    expect(parseError('')).toMatch(/1 to 6 fields/);
    expect(parseError(toFenString(START))).toBeNull();
    expect(fromFen('nonsense')).toBeNull();
  });

  it('builds the permalink and the Lichess editor link', () => {
    expect(labPath(EMPTY)).toBe(`/lab?fen=${encodeURIComponent('8/8/8/8/8/8/8/8 w - - 0 1')}`);
    expect(lichessEditorUrl(START)).toBe(
      'https://lichess.org/editor/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1',
    );
  });

  it('keeps castling rights in KQkq order', () => {
    expect(normalizeCastling('qKk')).toBe('Kkq');
    expect(normalizeCastling('')).toBe('');
  });
});
