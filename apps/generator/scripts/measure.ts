// Measurement run (Phase 4 plan, owner item 2): times the verification checks on real
// candidates per ply count, for the beam and the random source, before any pool is built.
//   pnpm --filter @retrograde/generator measure [width] [randomCount] [maxPlies] [nodeLimit] [children]
import type { Candidate, PlyStats, Verified } from '../src/candidates';
import { record } from '../src/candidates';
import { runBeam } from '../src/beam';
import { randomCandidates } from '../src/random';
import { verifyCandidate } from '../src/verify';

const width = Number(process.argv[2] ?? '50');
const randomCount = Number(process.argv[3] ?? '2000');
const maxPlies = Number(process.argv[4] ?? '12');
const NODE_LIMIT = Number(process.argv[5] ?? '100000');
const children = Number(process.argv[6] ?? '8');

const times = new Map<number, number[]>();
const inline = (batch: readonly Candidate[]): Promise<Verified[]> =>
  Promise.resolve(
    batch.map((candidate) => {
      const t0 = performance.now();
      const verification = verifyCandidate(
        candidate.target,
        candidate.moves.length,
        NODE_LIMIT,
        candidate.moves,
      );
      const elapsedMs = performance.now() - t0;
      const list = times.get(candidate.moves.length) ?? [];
      list.push(elapsedMs);
      times.set(candidate.moves.length, list);
      return { candidate, verification, elapsedMs };
    }),
  );

function pct(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function line(s: PlyStats, list: number[]): string {
  return (
    `N=${String(s.plies).padStart(2)} candidates ${String(s.candidates).padStart(6)} ` +
    `accepted ${String(s.accepted).padStart(5)} (${((100 * s.accepted) / Math.max(1, s.candidates)).toFixed(1)}%) ` +
    `not-unique ${String(s.notUnique).padStart(6)} not-shortest ${String(s.notShortest).padStart(4)} limit ${String(s.limit).padStart(3)} | ` +
    `ms/candidate median ${pct(list, 0.5).toFixed(2)} p95 ${pct(list, 0.95).toFixed(2)} max ${Math.max(0, ...list).toFixed(0)} total ${(s.totalMs / 1000).toFixed(1)} s`
  );
}

const t0 = performance.now();
console.log(`beam width ${String(width)}, up to ${String(maxPlies)} plies`);
const accepted = await runBeam({
  seed: 1,
  width,
  children,
  maxPlies,
  verifier: inline,
  onLevel: (s) => {
    console.log(line(s, times.get(s.plies) ?? []));
  },
});
console.log(
  `beam: ${String(accepted.length)} accepted in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);

times.clear();
const t1 = performance.now();
const random = randomCandidates(7, randomCount, 5, maxPlies, 10_000_000);
if (randomCount === 0) process.exit(0);
const stats = new Map<number, PlyStats>();
for (const v of await inline(random)) record(stats, v);
console.log(
  `random: ${String(random.length)} candidates in ${((performance.now() - t1) / 1000).toFixed(1)} s`,
);
for (const s of [...stats.values()].sort((a, b) => a.plies - b.plies)) {
  console.log(line(s, times.get(s.plies) ?? []));
}
