import { describe, expect, it } from 'vitest';
import { parseFen, perft, toFen } from '../src/index';
import { PERFT_CASES } from './perft-positions';

describe('perft (fast depths)', () => {
  for (const c of PERFT_CASES) {
    for (let depth = 1; depth <= c.fast; depth++) {
      it(`${c.name} depth ${String(depth)} = ${String(c.counts[depth - 1])}`, () => {
        const r = parseFen(c.fen);
        if (!r.ok) throw new Error('bad fixture');
        expect(perft(r.value, depth)).toBe(c.counts[depth - 1]);
        // perft must leave the position exactly as it found it.
        expect(toFen(r.value)).toBe(c.fen);
      });
    }
  }

  it('depth 0 is one node', () => {
    const r = parseFen(PERFT_CASES[0]?.fen ?? '');
    if (!r.ok) throw new Error('bad fixture');
    expect(perft(r.value, 0)).toBe(1);
  });
});
