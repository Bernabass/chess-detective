import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/positions.json' with { type: 'json' };
import { analyzePosition, replay, targetKey, type RuleId } from '../../src/index';
import { fen } from '../helpers';

interface Fixture {
  fen: string;
  expected: 'illegal' | 'legal' | 'undecided';
  rules: string[];
  absent?: string[];
  lastMoves?: string[];
  proof?: string[];
  depth?: number;
  comment: string;
}

const FIXTURES = fixtures as Fixture[];

describe('curated retro fixtures (SPEC §5.5)', () => {
  it('has at least 30 positions, each with a reasoning comment', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
    for (const f of FIXTURES) expect(f.comment.length).toBeGreaterThan(20);
  });

  it.each(FIXTURES)('$fen is $expected (depth $depth)', (f) => {
    const p = fen(f.fen);
    const report = analyzePosition(p, {
      depth: f.depth ?? 3,
      timeLimitMs: 20_000,
      nodeLimit: 2_000_000,
    });
    const rules = report.verdict.findings.map((x) => x.rule);

    if (f.expected === 'illegal') {
      expect(report.verdict.kind).toBe('illegal');
    } else if (f.expected === 'undecided') {
      expect(report.verdict.kind).toBe('undecided');
    } else {
      // Phase 2 has no solver: "legal" positions must not be called illegal. Phase 3 tightens
      // this to verdict "legal" with a proof.
      expect(report.verdict.kind).not.toBe('illegal');
    }

    for (const rule of f.rules) expect(rules).toContain(rule as RuleId);
    for (const rule of f.absent ?? []) expect(rules).not.toContain(rule as RuleId);

    for (const move of f.lastMoves ?? []) {
      const listed = report.lastMoves.moves.filter((m) => m.move === move);
      expect(listed.length, `${move} listed`).toBeGreaterThan(0);
      expect(
        listed.some((m) => m.viability === 'viable'),
        `${move} viable`,
      ).toBe(true);
    }

    if (f.proof !== undefined) {
      // The claimed proof game must really reach the position, including any stated castling
      // rights and en passant square.
      const r = replay(f.proof);
      if (!r.ok) throw new Error(`proof illegal at ${String(r.error.illegalAt)}`);
      expect(targetKey(r.value)).toBe(targetKey(p));
      expect(r.value.castling & p.castling).toBe(p.castling);
      if (p.epSquare >= 0) expect(r.value.epSquare).toBe(p.epSquare);
    }
  });
});
