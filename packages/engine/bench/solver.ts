// Solver benchmark (SPEC §6.5): pnpm --filter @retrograde/engine bench [targets-per-N]
// Solves targets of seeded random games at N = 6, 8 and 10 plies and prints the median and p95
// time and nodes for find-one (what the Lab's "Prove it" does) and for count with cap 2 (the
// uniqueness check the puzzle generator runs).
import { createRng, solveProofGame, targetKey } from '../src/index';
import { playRandomGame } from '../src/util/random-game';

const perN = Number(process.argv[2] ?? '50');

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

const uniform = () => 1;

for (const plies of [6, 8, 10]) {
  const rng = createRng(20261022 + plies);
  const targets: string[] = [];
  while (targets.length < perN) {
    const g = playRandomGame(rng, plies, undefined, uniform);
    if (g.moves.length === plies) targets.push(targetKey(g.position));
  }
  for (const mode of ['find-one', 'count'] as const) {
    const times: number[] = [];
    const nodes: number[] = [];
    let incomplete = 0;
    for (const target of targets) {
      const r = solveProofGame(target, { plies, mode, cap: mode === 'count' ? 2 : 1 });
      if (r.status !== 'complete' || r.count < 1) incomplete++;
      times.push(r.elapsedMs);
      nodes.push(r.nodes);
    }
    const label = mode === 'count' ? 'count (cap 2)' : 'find-one';
    console.log(
      `N=${String(plies).padStart(2)} ${label.padEnd(13)} median ${String(percentile(times, 0.5)).padStart(6)} ms, ` +
        `p95 ${String(percentile(times, 0.95)).padStart(6)} ms, max ${String(Math.max(...times)).padStart(6)} ms | ` +
        `nodes median ${String(percentile(nodes, 0.5)).padStart(8)}, p95 ${String(percentile(nodes, 0.95)).padStart(9)}` +
        (incomplete > 0 ? ` | ${String(incomplete)} NOT SOLVED` : ''),
    );
  }
}
