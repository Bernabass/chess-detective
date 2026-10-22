import { describe, expect, it } from 'vitest';
import { retractions, toFen, uciToMove, type Position, type Retraction } from '../../src/index';
import { fen } from '../helpers';

function priorOf(r: Retraction | undefined): Position {
  if (r === undefined) throw new Error('expected a retraction');
  return r.prior;
}

function retract(text: string): Retraction[] {
  return retractions(fen(text));
}

/** "move kind uncaptured" summaries, sorted, for compact assertions. */
function summary(text: string): string[] {
  return retract(text)
    .map((r) => [r.move, r.kind, r.uncaptured ?? ''].join(' ').trim())
    .sort();
}

describe('retractions (SPEC §5.3)', () => {
  it('a stated en passant square allows only the matching double push', () => {
    const r = retract('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(r.map((x) => x.move)).toEqual(['e2e4']);
    expect(toFen(priorOf(r[0]))).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('with "-" the double push is still found, alongside other moves', () => {
    // SPEC §5.3 step 3: "-" means "not stated".
    const s = summary('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(s).toEqual(
      expect.arrayContaining(['e2e4 normal', 'e3e4 normal', 'f3g1 normal', 'a3b1 normal']),
    );
    // Black already has 16 pieces, so nothing can have been captured.
    expect(s.some((x) => x.includes('uncapture'))).toBe(false);
  });

  it('un-captures every possible enemy piece type', () => {
    const s = summary('4k3/8/8/1B6/8/8/8/4K3 b - - 0 1');
    expect(s).toEqual(
      expect.arrayContaining([
        'f1b5 normal',
        'f1b5 uncapture n',
        'f1b5 uncapture b',
        'f1b5 uncapture r',
        'f1b5 uncapture q',
        'f1b5 uncapture p',
      ]),
    );
  });

  it('un-promotes, with and without an un-capture', () => {
    const s = summary('Q3k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(s).toEqual(
      expect.arrayContaining(['a7a8q unpromotion', 'b7a8q unpromotion-uncapture r']),
    );
    // No enemy pawn can be un-captured on the last rank.
    expect(s).not.toContain('b7a8q unpromotion-uncapture p');
  });

  it('un-captures en passant', () => {
    const r = retract('4k3/8/3P4/8/8/8/8/4K3 b - - 0 1').filter((x) => x.kind === 'un-en-passant');
    expect(r.map((x) => x.move).sort()).toEqual(['c5d6', 'e5d6']);
    const prior = priorOf(r.find((x) => x.move === 'e5d6'));
    expect(toFen(prior)).toBe('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  });

  it('un-castles and restores the right it used', () => {
    const r = retract('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 0 1').filter((x) => x.kind === 'uncastle');
    expect(r.map((x) => x.move)).toEqual(['e1g1']);
    expect(toFen(priorOf(r[0]))).toBe('r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1');
  });

  it('respects stated castling rights: the king and rooks never moved', () => {
    const claimed = retract('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    expect(claimed.filter((x) => ['e1', 'a1', 'h1'].includes(x.move.slice(2, 4)))).toEqual([]);
    const unstated = summary('r3k2r/8/8/8/8/8/8/R3K2R b kq - 0 1');
    expect(unstated).toEqual(expect.arrayContaining(['d1e1 normal', 'h2h1 normal', 'a5a1 normal']));
  });

  it('rejects priors where the side to move could capture the king', () => {
    // Black king g8, white king e7: from f8 the black king would have been next to the white
    // king, so only h8-g8 is possible.
    const s = summary('6k1/4Kppp/8/8/8/8/8/8 w - - 0 1');
    expect(s.every((x) => x.startsWith('h8g8'))).toBe(true);
    expect(s).toContain('h8g8 normal');
  });

  it('pawns on their start rank cannot be retracted, nor onto their first rank', () => {
    expect(retract('4k3/8/8/8/8/8/P7/4K3 b - - 0 1').filter((x) => x.move.endsWith('a2'))).toEqual(
      [],
    );
  });

  it('works for Black as the retractor, including un-en-passant', () => {
    const r = retract('4k3/8/8/8/8/4p3/8/4K3 w - - 0 1');
    expect(
      r
        .filter((x) => x.kind === 'un-en-passant')
        .map((x) => x.move)
        .sort(),
    ).toEqual(['d4e3', 'f4e3']);
    expect(r.find((x) => x.move === 'e4e3')?.kind).toBe('normal');
    // The prior position has Black to move and the move number goes back by one.
    const prior = priorOf(r.find((x) => x.move === 'e4e3'));
    expect(toFen(prior)).toBe('4k3/8/8/8/4p3/8/8/4K3 b - - 0 1');
  });

  it('every retraction plays forward to the position again', () => {
    for (const text of [
      'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 0 1',
      'Q3k3/8/8/8/8/8/8/4K3 b - - 0 1',
      '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    ]) {
      for (const r of retract(text)) {
        expect(r.prior.turn).not.toBe(fen(text).turn);
        expect(uciToMove(r.prior, r.move).ok, `${r.move} from ${toFen(r.prior)}`).toBe(true);
      }
    }
  });

  it('never crashes on illegal positions', () => {
    for (const text of [
      '8/8/8/8/8/8/8/8 w - - 0 1',
      'KK6/8/8/8/8/8/8/k7 w - - 0 1',
      'k7/8/8/8/8/8/8/K6P w - - 0 1',
      '4k3/4R3/8/8/8/8/8/4K3 w KQkq e6 0 1',
      'QQQQQQQQ/QQQQQQQQ/8/8/8/8/8/k6K b - - 0 1',
    ]) {
      expect(() => retract(text)).not.toThrow();
    }
  });
});
