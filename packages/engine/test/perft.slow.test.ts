import { describe, expect, it } from 'vitest';
import { parseFen, perft } from '../src/index';
import { PERFT_CASES } from './perft-positions';

describe('perft (slow depths)', () => {
  for (const c of PERFT_CASES) {
    it(`${c.name} depth 5 = ${String(c.counts[4])}`, () => {
      const r = parseFen(c.fen);
      if (!r.ok) throw new Error('bad fixture');
      expect(perft(r.value, 5)).toBe(c.counts[4]);
    });
  }

  it('start depth 6 = 119060324', () => {
    const r = parseFen(PERFT_CASES[0]?.fen ?? '');
    if (!r.ok) throw new Error('bad fixture');
    expect(perft(r.value, 6)).toBe(119060324);
  });
});
