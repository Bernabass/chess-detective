import {
  dailyFeedback,
  replay,
  shortestProofGame,
  solveProofGame,
  targetKey,
} from '@retrograde/engine';
import { describe, expect, it } from 'vitest';
import { HOW_TO_EXAMPLE } from './howto';

// The How to play example must teach the real rules: daily puzzles are unique shortest proof
// games, so the example's target must be one too, or "right but swapped" could also solve it.
describe('the How to play example', () => {
  const { solution, guess, feedback, target } = HOW_TO_EXAMPLE;

  it('has the target its solution reaches', () => {
    const p = replay(solution);
    expect(p.ok && targetKey(p.value)).toBe(target);
  });

  it('is a shortest proof game (the solver finds nothing shorter)', () => {
    const r = shortestProofGame(target, solution.length);
    expect(r.status).toBe('complete');
    expect(r.plies).toBe(solution.length);
  });

  it('is unique: exactly one game of that length reaches it', () => {
    const r = solveProofGame(target, { plies: solution.length, mode: 'count', cap: 2 });
    expect(r.status).toBe('complete');
    expect(r.count).toBe(1);
  });

  it("shows the reference feedback for its guess, and the guess doesn't solve it", () => {
    expect(dailyFeedback(solution, guess)).toBe(feedback);
    const p = replay(guess);
    expect(p.ok).toBe(true);
    expect(p.ok && targetKey(p.value)).not.toBe(target);
  });
});
