import type { Verdict } from '@retrograde/engine';

/** The one-sentence reason under the verdict word (SPEC §9.2). */
export function verdictReason(v: Verdict): string {
  if (v.kind === 'illegal') {
    const first = v.findings.find((f) => f.severity === 'illegal');
    return first?.message ?? 'This position contains a contradiction.';
  }
  if (v.kind === 'legal') {
    const n = v.proof.length;
    return n === 0
      ? 'This is the starting position: the empty game reaches it.'
      : `Proved: a ${String(n)}-ply game from the starting position reaches it (shown below).`;
  }
  return v.reason === 'search-limit'
    ? 'The search ran out of time before finding a contradiction or a proof game.'
    : 'No contradiction found, and no proof game of up to 10 plies. Prove it searches longer games.';
}
