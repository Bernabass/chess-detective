/**
 * Daily-puzzle feedback (SPEC §8.3), the reference implementation: G where the guess move
 * equals the solution move at that ply; otherwise Y if it equals a not-yet-used solution move at
 * another ply of the same colour (leftmost first, plies processed left to right); otherwise X.
 * Greens are assigned first. The server computes the feedback players get (Go, checked against
 * fixtures/feedback-vectors.json, which this function generates); the web app only uses this for
 * its examples.
 */
export function dailyFeedback(solution: readonly string[], guess: readonly string[]): string {
  const out: string[] = guess.map((g, i) => (g === solution[i] ? 'G' : 'X'));
  const used = solution.map((s, i) => s === guess[i]);
  guess.forEach((g, i) => {
    if (out[i] === 'G') return;
    for (let j = i % 2; j < solution.length; j += 2) {
      if (j !== i && !used[j] && solution[j] === g) {
        out[i] = 'Y';
        used[j] = true;
        return;
      }
    }
  });
  return out.join('');
}
