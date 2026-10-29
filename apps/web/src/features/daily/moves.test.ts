import { describe, expect, it } from 'vitest';
import { boardState, differences, movesReducer, parseTypedMove } from './moves';

describe('the guess being played', () => {
  it('starts from the initial position with the legal destinations', () => {
    const s = boardState([], 4);
    expect(s.turnColor).toBe('white');
    expect(s.dests.get('e2')).toEqual(['e3', 'e4']);
    expect(s.dests.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(s.steps).toEqual([]);
    expect(s.complete).toBe(false);
  });

  it('follows the moves, in SAN, with check and the last move', () => {
    const s = boardState(['e2e4', 'f7f6', 'd1h5'], 4);
    expect(s.steps.map((x) => x.label)).toEqual([
      '1.e4',
      `1${String.fromCodePoint(0x2026)}f6`,
      '2.Qh5+',
    ]);
    expect(s.turnColor).toBe('black');
    expect(s.check).toBe(true);
    expect(s.lastMove).toEqual(['d1', 'h5']);
  });

  it('offers no more moves once the guess has all its plies', () => {
    const s = boardState(['e2e4', 'e7e5'], 2);
    expect(s.complete).toBe(true);
    expect(s.dests.size).toBe(0);
  });

  it('knows which moves need a promotion choice', () => {
    const moves = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'b8c6'];
    const s = boardState(moves, 12);
    expect(s.needsPromotion('b7', 'a8')).toBe(true);
    expect(s.needsPromotion('b7', 'b8')).toBe(true);
    expect(s.needsPromotion('e2', 'e4')).toBe(false);
  });

  it('accepts typed moves in SAN or UCI, and explains a bad one', () => {
    expect(parseTypedMove([], 'Nf3')).toEqual({ ok: true, uci: 'g1f3' });
    expect(parseTypedMove([], 'e2e4')).toEqual({ ok: true, uci: 'e2e4' });
    expect(parseTypedMove([], ' E2E4 ')).toEqual({ ok: true, uci: 'e2e4' });
    expect(parseTypedMove([], 'e5').ok).toBe(false);
    expect(parseTypedMove([], '').ok).toBe(false);
    const promo = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'b8c6'];
    expect(parseTypedMove(promo, 'bxa8=Q')).toEqual({ ok: true, uci: 'b7a8q' });
    expect(parseTypedMove(promo, 'b7a8n')).toEqual({ ok: true, uci: 'b7a8n' });
    // Forms players often type: a lower-case promotion piece, castling with zeros.
    expect(parseTypedMove(promo, 'bxa8=q')).toEqual({ ok: true, uci: 'b7a8q' });
    const castle = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'];
    expect(parseTypedMove(castle, '0-0')).toEqual({ ok: true, uci: 'e1g1' });
    expect(parseTypedMove(castle, 'O-O')).toEqual({ ok: true, uci: 'e1g1' });
  });

  it('plays, undoes, resets and loads within the ply limit', () => {
    let s = movesReducer({ moves: [], max: 2 }, { type: 'play', uci: 'e2e4' });
    s = movesReducer(s, { type: 'play', uci: 'e7e5' });
    expect(s.moves).toEqual(['e2e4', 'e7e5']);
    expect(movesReducer(s, { type: 'play', uci: 'g1f3' }).moves).toEqual(['e2e4', 'e7e5']);
    expect(movesReducer(s, { type: 'undo' }).moves).toEqual(['e2e4']);
    expect(movesReducer(s, { type: 'reset' }).moves).toEqual([]);
    expect(movesReducer(s, { type: 'load', moves: ['d2d4', 'd7d5', 'c2c4'] }).moves).toEqual([
      'd2d4',
      'd7d5',
    ]);
    // An illegal move is ignored rather than corrupting the guess.
    expect(movesReducer(s, { type: 'undo' }).moves).toEqual(['e2e4']);
    expect(movesReducer({ moves: [], max: 2 }, { type: 'play', uci: 'e2e5' }).moves).toEqual([]);
  });

  it('lists the squares where two placements differ (the difference overlay)', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    const after = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
    expect(differences(start, after).sort()).toEqual(['e2', 'e4', 'e5', 'e7']);
    expect(differences(start, start)).toEqual([]);
  });
});
