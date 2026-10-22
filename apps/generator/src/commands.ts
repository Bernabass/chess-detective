import { ENGINE_VERSION, targetKey } from '@retrograde/engine';
import { replayMoves } from './beam';
import type { Candidate, PlyStats } from './candidates';
import { assignStars } from './difficulty';
import { FEATURES } from './features';
import { sanLine } from './moves';
import { describePuzzle, type PuzzleRecord } from './puzzle';
import { createVerifier } from './workers';

/** Side file written next to the output: how the pool was generated (timings vary by machine). */
export interface GenerationReport {
  engineVersion: string;
  options: Record<string, number | string>;
  elapsedMs: number;
  accepted: number;
  stats: PlyStats[];
  quotas: { min: number; max: number; wanted: number; found: number }[];
}

export function statsPath(out: string): string {
  return `${out}.stats.json`;
}

/**
 * Re-checks every puzzle of a file (the `verify` command): the solution is legal and reaches the
 * target in exactly `plies`, the solver still finds it the unique shortest proof game, ids are
 * unique, and features, score and stars match a fresh computation. solverNodes (and so the score)
 * is only compared when the file was made by this engine version. Returns the problems found.
 */
export async function checkRecords(
  records: readonly PuzzleRecord[],
  jobs: number,
  nodeLimit: number,
): Promise<string[]> {
  const problems: string[] = [];
  const ids = new Set<string>();
  const candidates: Candidate[] = [];
  records.forEach((r, i) => {
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (r.plies !== r.solution.length)
      problems.push(`${r.id}: plies ${String(r.plies)} but ${String(r.solution.length)} moves`);
    let reached: string;
    try {
      reached = targetKey(replayMoves(r.solution));
    } catch (error) {
      problems.push(`${r.id}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (reached !== r.target)
      problems.push(`${r.id}: solution reaches ${reached}, not ${r.target}`);
    candidates.push({ index: i, moves: r.solution, target: r.target, source: 'beam' });
  });

  const pool = createVerifier(jobs, nodeLimit);
  try {
    for (const v of await pool.verify(candidates)) {
      const r = records[v.candidate.index];
      if (r === undefined) continue;
      if (v.verification.status !== 'accepted') {
        problems.push(`${r.id}: ${v.verification.status}`);
        continue;
      }
      const sameEngine = r.engineVersion === ENGINE_VERSION;
      const fresh = describePuzzle(
        r.seed,
        0,
        r.solution,
        r.target,
        sameEngine ? v.verification.solverNodes : r.solverNodes,
      );
      if (fresh.features.join(',') !== r.features.join(',')) {
        problems.push(
          `${r.id}: features ${r.features.join(',')} but computed ${fresh.features.join(',')}`,
        );
      }
      if (sameEngine && fresh.solverNodes !== r.solverNodes) {
        problems.push(
          `${r.id}: solverNodes ${String(r.solverNodes)} but computed ${String(fresh.solverNodes)}`,
        );
      }
      if (fresh.score !== r.score)
        problems.push(`${r.id}: score ${String(r.score)} but computed ${String(fresh.score)}`);
    }
  } finally {
    await pool.close();
  }

  const stars = assignStars(records);
  records.forEach((r, i) => {
    if (stars[i] !== r.difficulty) {
      problems.push(
        `${r.id}: difficulty ${String(r.difficulty)} but its rank gives ${String(stars[i])}`,
      );
    }
  });
  return problems;
}

function table(rows: string[][]): string {
  const widths =
    rows[0]?.map((_, c) => Math.max(...rows.map((row) => (row[c] ?? '').length))) ?? [];
  return rows
    .map((row) => row.map((cell, c) => cell.padStart(widths[c] ?? 0)).join('  '))
    .join('\n');
}

/** The `stats` command: the pool by ply count, stars and features, plus the generation report. */
export function formatStats(
  records: readonly PuzzleRecord[],
  report: GenerationReport | null,
): string {
  const lines: string[] = [`${String(records.length)} puzzles`];

  const plies = [...new Set(records.map((r) => r.plies))].sort((a, b) => a - b);
  lines.push('', 'By ply count:');
  lines.push(
    table([
      ['plies', 'puzzles', '★', '★★', '★★★', '★★★★', '★★★★★'],
      ...plies.map((n) => {
        const at = records.filter((r) => r.plies === n);
        return [
          String(n),
          String(at.length),
          ...[1, 2, 3, 4, 5].map((s) => String(at.filter((r) => r.difficulty === s).length)),
        ];
      }),
    ]),
  );

  lines.push('', 'By stars:');
  lines.push(
    table([
      ['stars', 'puzzles', 'score min', 'score max', 'plies min', 'plies max'],
      ...[1, 2, 3, 4, 5].map((s) => {
        const at = records.filter((r) => r.difficulty === s);
        const scores = at.map((r) => r.score);
        const ps = at.map((r) => r.plies);
        const fmt = (xs: number[], f: (...v: number[]) => number): string =>
          xs.length === 0 ? '-' : String(f(...xs));
        return [
          '★'.repeat(s),
          String(at.length),
          fmt(scores, Math.min),
          fmt(scores, Math.max),
          fmt(ps, Math.min),
          fmt(ps, Math.max),
        ];
      }),
    ]),
  );

  lines.push('', 'Features:');
  lines.push(
    table([
      ['feature', 'puzzles'],
      ...FEATURES.map((f) => [f, String(records.filter((r) => r.features.includes(f)).length)]),
    ]),
  );

  if (report !== null) {
    lines.push(
      '',
      `Generation (engine ${report.engineVersion}, ${(report.elapsedMs / 1000).toFixed(0)} s, ${String(report.accepted)} accepted in range):`,
    );
    lines.push(
      table([
        [
          'plies',
          'candidates',
          'accepted',
          'rate',
          'not-unique',
          'not-shortest',
          'limit',
          'ms/candidate',
          'max ms',
        ],
        ...report.stats.map((s) => [
          String(s.plies),
          String(s.candidates),
          String(s.accepted),
          `${((100 * s.accepted) / Math.max(1, s.candidates)).toFixed(1)}%`,
          String(s.notUnique),
          String(s.notShortest),
          String(s.limit),
          (s.totalMs / Math.max(1, s.candidates)).toFixed(1),
          s.maxMs.toFixed(0),
        ]),
      ]),
    );
    lines.push('', 'Ply quotas:');
    lines.push(
      table([
        ['plies', 'wanted', 'found'],
        ...report.quotas.map((q) => [
          `${String(q.min)}-${String(q.max)}`,
          String(q.wanted),
          String(q.found),
        ]),
      ]),
    );
  }
  return lines.join('\n');
}

/**
 * `perLevel` sample puzzles per star level, spread over the level's score range (for reviewing
 * whether the puzzles are interesting): target, ply count, features and the solution in SAN.
 */
export function formatSamples(records: readonly PuzzleRecord[], perLevel: number): string {
  const lines: string[] = [];
  for (let stars = 1; stars <= 5; stars++) {
    const level = records
      .filter((r) => r.difficulty === stars)
      .sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
    lines.push(`${'★'.repeat(stars)} (${String(level.length)} puzzles)`);
    for (let k = 1; k <= perLevel && level.length > 0; k++) {
      const r = level[Math.min(level.length - 1, Math.floor((k * level.length) / (perLevel + 1)))];
      if (r === undefined) continue;
      const features = r.features.length === 0 ? 'none' : r.features.join(', ');
      lines.push(
        `  ${r.id}  ${String(r.plies)} plies  score ${String(r.score)}  features: ${features}`,
      );
      lines.push(`    target   ${r.target}`);
      lines.push(`    solution ${sanLine(r.solution)}`);
    }
  }
  return lines.join('\n');
}
