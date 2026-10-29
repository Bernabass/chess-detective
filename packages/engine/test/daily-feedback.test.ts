import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dailyFeedback } from '../src/index';

interface Vectors {
  vectors: { comment: string; solution: string[]; guess: string[]; feedback: string }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../fixtures/feedback-vectors.json', import.meta.url), 'utf8'),
) as Vectors;

describe('dailyFeedback (SPEC §8.3)', () => {
  it('matches every vector in fixtures/feedback-vectors.json', () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(13);
    for (const v of vectors.vectors) {
      expect(dailyFeedback(v.solution, v.guess), v.comment).toBe(v.feedback);
    }
  });

  it("matches SPEC §8.3's table", () => {
    const split = (s: string): string[] => s.split(' ');
    expect(
      dailyFeedback(split('e2e4 e7e5 g1f3 g8f6 f3g1 f6g8'), split('g1f3 e7e5 e2e4 g8f6 f3g1 b8c6')),
    ).toBe('YGYGGX');
    expect(
      dailyFeedback(split('g1f3 g8f6 f3g1 f6g8 g1f3 b8c6'), split('g1f3 b8c6 f3g1 c6b8 g1f3 g8f6')),
    ).toBe('GYGXGY');
    expect(
      dailyFeedback(split('g1f3 g8f6 f3g1 f6g8 g1f3 b8c6'), split('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6')),
    ).toBe('GGGGGX');
  });
});
