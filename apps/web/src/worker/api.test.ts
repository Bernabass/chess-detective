// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../features/lab/examples';
import { analyze, lastMoves, prove, type ProveProgress } from './api';

describe('engine worker API', () => {
  it('analyzes every Lab example to the verdict the gallery promises', () => {
    for (const ex of EXAMPLES) {
      const r = analyze(ex.fen, 3);
      expect(r.ok, ex.title).toBe(true);
      if (r.ok) expect(r.value.verdict.kind, ex.title).toBe(ex.verdict);
    }
  });

  it('names the contradiction for an illegal position', () => {
    const r = analyze('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1', 3);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.verdict.findings.map((f) => f.rule)).toContain('PAWN_STRUCTURE_IMPOSSIBLE');
  });

  it('reports an invalid FEN as an error, not an exception', () => {
    expect(analyze('not a fen', 3)).toMatchObject({ ok: false });
    expect(prove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w - - 0 1', 4)).toMatchObject({
      ok: false,
    });
  });

  it('lists last moves at a depth', () => {
    const r = lastMoves('6k1/4Kppp/8/8/8/8/8/8 w - - 0 1', 2);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.depth).toBe(2);
    expect(r.value.moves.some((m) => m.move === 'h8g8' && m.viability === 'viable')).toBe(true);
  });

  it('proves the bishop example in 12 plies, reporting each length it searches', () => {
    const seen: ProveProgress[] = [];
    const r = prove('rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1', 16, (p) => seen.push(p));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.solution).toHaveLength(12);
    expect(r.value.status).toBe('complete');
    expect(seen.at(-1)?.plies).toBe(12);
  });

  it('says how long a proof must at least be when it is beyond the limit', () => {
    const r = prove('8/8/8/8/8/8/8/K6k w - - 0 1', 16);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.solution).toBeNull();
    expect(r.value.minimumPlies).toBeGreaterThan(16);
  });
});
