import { describe, expect, it } from 'vitest';
import { BLACK, WHITE, squareName } from '../../src/core/board';
import { pawnAccounting } from '../../src/retro/pawns';
import { fen } from '../helpers';

const names = (squares: readonly number[]) => squares.map(squareName);

describe('pawnAccounting (SPEC §5.2.1)', () => {
  it('needs no captures for pawns on their own files', () => {
    const r = pawnAccounting(
      fen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board,
      WHITE,
    );
    expect(r).toEqual({ kind: 'ok', minCaptures: 0, capturingPawns: [] });
  });

  it('counts one capture for a doubled pawn', () => {
    const r = pawnAccounting(
      fen('rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1').board,
      WHITE,
    );
    expect(r.kind === 'ok' && r.minCaptures).toBe(1);
    expect(r.kind === 'ok' && names(r.capturingPawns)).toEqual(['c3']);
  });

  it('finds the cheapest assignment, not a greedy one', () => {
    // c3 and c4 are doubled and b2 is home: c3 stays on c (0), c4 comes from d (1).
    const r = pawnAccounting(fen('k7/8/8/8/2P5/2P5/1P6/K7 w - - 0 1').board, WHITE);
    expect(r.kind === 'ok' && r.minCaptures).toBe(1);
  });

  it('lets a far-advanced pawn come from a distant file', () => {
    // b7 has travelled 5 ranks; the c- to h-files are taken, so it came from a or b.
    const r = pawnAccounting(fen('k7/1P6/8/8/8/8/2PPPPPP/K7 w - - 0 1').board, WHITE);
    expect(r).toEqual({ kind: 'ok', minCaptures: 0, capturingPawns: [] });
  });

  it('reports the blocking group when the structure is impossible', () => {
    const r = pawnAccounting(fen('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1').board, WHITE);
    expect(r.kind).toBe('impossible');
    if (r.kind !== 'impossible') return;
    expect(squareName(r.unmatched)).toBe('a3');
    expect(names(r.group)).toEqual(['a2', 'b2', 'a3']);
    expect(r.files).toEqual([0, 1]);
    // Hall's condition fails by exactly one: |N(S)| = |S| - 1.
    expect(r.files.length).toBe(r.group.length - 1);
  });

  it('respects the rank distance limit on file changes', () => {
    // a7 has travelled 5 ranks (files a-f), but a2-f2 already use every one of those files.
    const r = pawnAccounting(fen('k7/P7/8/8/8/8/PPPPPPP1/K7 w - - 0 1').board, WHITE);
    expect(r.kind).toBe('impossible');
    if (r.kind !== 'impossible') return;
    expect(squareName(r.unmatched)).toBe('a7');
    expect(r.group).toHaveLength(7);
    expect(r.files).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('mirrors for Black', () => {
    const r = pawnAccounting(fen('k7/pp6/pp6/8/8/8/8/K7 w - - 0 1').board, BLACK);
    expect(r.kind).toBe('impossible');
    if (r.kind !== 'impossible') return;
    expect(squareName(r.unmatched)).toBe('a6');
    expect(names(r.group).sort()).toEqual(['a6', 'a7', 'b7']);
    const doubled = pawnAccounting(
      fen('rnbqkbnr/p1pppppp/2p5/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board,
      BLACK,
    );
    expect(doubled.kind === 'ok' && doubled.minCaptures).toBe(1);
  });

  it('skips more than 8 pawns and ignores pawns on back ranks (other rules cover those)', () => {
    expect(pawnAccounting(fen('k7/8/8/8/8/P7/PPPPPPPP/K7 w - - 0 1').board, WHITE).kind).toBe(
      'skipped',
    );
    const r = pawnAccounting(fen('k7/8/8/8/8/8/8/K6P w - - 0 1').board, WHITE);
    expect(r).toEqual({ kind: 'ok', minCaptures: 0, capturingPawns: [] });
  });
});
