import { runBeam } from './beam';
import { record, type PlyStats, type Verified } from './candidates';
import { assignStars } from './difficulty';
import { choosePool, PLY_QUOTAS, type PlyQuota, type PoolResult } from './pool';
import { describePuzzle, type PuzzleRecord } from './puzzle';
import { randomCandidates } from './random';
import { createVerifier } from './workers';

export interface GenerateOptions {
  count: number;
  seed: number;
  minPlies: number;
  maxPlies: number;
  jobs: number;
  source: 'beam' | 'random' | 'both';
  nodeLimit: number;
  /** Beam frontier width. */
  width: number;
  /** Beam: candidates verified per parent. */
  children: number;
  /** Random-source candidates. */
  random: number;
  /** Progress lines (never part of the output). */
  log?: (line: string) => void;
}

export interface GenerateResult {
  puzzles: PuzzleRecord[];
  /** Per ply count, both sources together. */
  stats: PlyStats[];
  quotas: PoolResult<{ index: number; moves: readonly string[]; score: number }>['quotas'];
  accepted: number;
}

/** Random candidates get indices from here, so they never collide with beam indices. */
export const RANDOM_FIRST_INDEX = 1_000_000;

/**
 * Generates a pool (SPEC §7): beam and/or random candidates, every one fully verified, then
 * `count` puzzles chosen by ply quotas and the prefix cap, scored, and given stars by rank.
 * Deterministic for a given seed, options and engine version, whatever `jobs` is.
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const log = opts.log ?? (() => undefined);
  const pool = createVerifier(opts.jobs, opts.nodeLimit);
  const stats = new Map<number, PlyStats>();
  const accepted: Verified[] = [];
  try {
    if (opts.source !== 'random') {
      let levelStart = performance.now();
      const nodes = await runBeam({
        seed: opts.seed,
        width: opts.width,
        children: opts.children,
        maxPlies: opts.maxPlies,
        verifier: async (batch) => {
          const results = await pool.verify(batch);
          for (const v of results) record(stats, v);
          return results;
        },
        onLevel: (s) => {
          const now = performance.now();
          log(
            `beam N=${String(s.plies)}: ${String(s.accepted)}/${String(s.candidates)} accepted, ` +
              `${String(s.limit)} at the node limit, ${((now - levelStart) / 1000).toFixed(1)} s ` +
              `(${(s.totalMs / 1000).toFixed(1)} s of verification over all jobs)`,
          );
          levelStart = now;
        },
      });
      accepted.push(...nodes.map((n) => n.verified));
    }
    if (opts.source !== 'beam') {
      const candidates = randomCandidates(
        opts.seed,
        opts.random,
        opts.minPlies,
        opts.maxPlies,
        RANDOM_FIRST_INDEX,
      );
      const results = await pool.verify(candidates);
      for (const v of results) record(stats, v);
      const ok = results.filter((v) => v.verification.status === 'accepted');
      log(`random: ${String(ok.length)}/${String(results.length)} accepted`);
      accepted.push(...ok);
    }
  } finally {
    await pool.close();
  }

  // The same target can come from both sources; keep the lowest index.
  const byTarget = new Map<string, Verified>();
  for (const v of [...accepted].sort((a, b) => a.candidate.index - b.candidate.index)) {
    const n = v.candidate.moves.length;
    if (n < opts.minPlies || n > opts.maxPlies) continue;
    const key = `${String(n)} ${v.candidate.target}`;
    if (!byTarget.has(key)) byTarget.set(key, v);
  }
  const described = [...byTarget.values()].map((v) => ({
    index: v.candidate.index,
    moves: v.candidate.moves,
    record: describePuzzle(
      opts.seed,
      v.candidate.index,
      v.candidate.moves,
      v.candidate.target,
      v.verification.solverNodes,
    ),
  }));
  const chosen = choosePool(
    described.map((d) => ({ ...d, score: d.record.score })),
    opts.count,
    quotasFor(opts.minPlies, opts.maxPlies),
    opts.minPlies,
    opts.maxPlies,
  );
  const stars = assignStars(chosen.chosen.map((c) => ({ id: c.record.id, score: c.record.score })));
  const puzzles = chosen.chosen.map((c, i) => ({ ...c.record, difficulty: stars[i] ?? 0 }));
  return {
    puzzles,
    stats: [...stats.values()].sort((a, b) => a.plies - b.plies),
    quotas: chosen.quotas,
    accepted: described.length,
  };
}

/**
 * The standard ply quotas fitted to [minPlies, maxPlies]: quotas outside the range are dropped,
 * the shortest and longest remaining ones are stretched to the range's ends (so --min-plies 3 or
 * --max-plies 14 still get puzzles of those lengths), and the shares are rescaled to 1.
 */
export function quotasFor(minPlies: number, maxPlies: number): PlyQuota[] {
  const clipped = PLY_QUOTAS.filter((q) => q.max >= minPlies && q.min <= maxPlies).map((q) => ({
    min: Math.max(q.min, minPlies),
    max: Math.min(q.max, maxPlies),
    share: q.share,
  }));
  const first = clipped[0];
  const last = clipped.at(-1);
  if (first === undefined || last === undefined)
    return [{ min: minPlies, max: maxPlies, share: 1 }];
  first.min = minPlies;
  last.max = maxPlies;
  const total = clipped.reduce((sum, q) => sum + q.share, 0);
  return clipped.map((q) => ({ ...q, share: q.share / total }));
}
