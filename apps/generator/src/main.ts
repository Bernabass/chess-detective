import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINE_VERSION } from '@retrograde/engine';
import {
  checkRecords,
  formatSamples,
  formatStats,
  statsPath,
  type GenerationReport,
} from './commands';
import { generate } from './generate';
import { formatRecord, parseRecords } from './puzzle';
import { usage } from './usage';

/** Parses `--name value` pairs and positional arguments. */
function parseArgs(argv: readonly string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      flags.set(arg.slice(2), value);
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function intFlag(flags: Map<string, string>, name: string, fallback?: number): number {
  const raw = flags.get(name);
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`--${name} is required`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

const DEFAULT_NODE_LIMIT = 200_000;

/** --seed: every derived seed is 32-bit, so larger seeds would collide with smaller ones. */
function seedFlag(flags: Map<string, string>): number {
  const seed = intFlag(flags, 'seed');
  if (seed > 0x7fffffff) throw new Error('--seed must be at most 2147483647');
  return seed;
}

/**
 * A path from the command line, relative to where the user ran the command. `pnpm --filter ...`
 * runs the script inside apps/generator and puts the original directory in INIT_CWD.
 */
function userPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

async function main(argv: readonly string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  if (command === 'generate') {
    const outFlag = flags.get('out');
    if (outFlag === undefined) throw new Error('--out is required');
    const out = userPath(outFlag);
    const source = flags.get('source') ?? 'both';
    if (source !== 'beam' && source !== 'random' && source !== 'both') {
      throw new Error(`--source must be beam, random or both, got "${source}"`);
    }
    const count = intFlag(flags, 'count');
    const options = {
      count,
      seed: seedFlag(flags),
      minPlies: intFlag(flags, 'min-plies', 5),
      maxPlies: intFlag(flags, 'max-plies', 12),
      jobs: Math.max(1, intFlag(flags, 'jobs', 1)),
      source,
      nodeLimit: intFlag(flags, 'node-limit', DEFAULT_NODE_LIMIT),
      width: intFlag(flags, 'width', 180),
      children: intFlag(flags, 'children', 8),
      random: intFlag(flags, 'random', 4 * count),
    } as const;
    if (options.minPlies < 1 || options.maxPlies < options.minPlies)
      throw new Error('need 1 <= --min-plies <= --max-plies');
    const t0 = performance.now();
    const result = await generate({
      ...options,
      log: (line) => {
        console.error(line);
      },
    });
    writeFileSync(out, result.puzzles.map((p) => `${formatRecord(p)}\n`).join(''));
    const report: GenerationReport = {
      engineVersion: ENGINE_VERSION,
      options: { ...options },
      elapsedMs: Math.round(performance.now() - t0),
      accepted: result.accepted,
      stats: result.stats.map((s) => ({
        ...s,
        totalMs: Math.round(s.totalMs),
        maxMs: Math.round(s.maxMs),
      })),
      quotas: result.quotas.map((q) => ({
        min: q.quota.min,
        max: q.quota.max,
        wanted: q.wanted,
        found: q.found,
      })),
    };
    writeFileSync(statsPath(out), `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatStats(result.puzzles, report));
    if (result.puzzles.length < count) {
      console.error(
        `only ${String(result.puzzles.length)} of ${String(count)} puzzles: raise --width or --random`,
      );
      return 1;
    }
    return 0;
  }

  if (command === 'verify') {
    const fileArg = positional[1];
    if (fileArg === undefined) throw new Error('verify needs a file');
    const file = userPath(fileArg);
    const records = parseRecords(readFileSync(file, 'utf8'));
    const problems = await checkRecords(
      records,
      Math.max(1, intFlag(flags, 'jobs', 1)),
      intFlag(flags, 'node-limit', DEFAULT_NODE_LIMIT),
    );
    for (const problem of problems) console.error(problem);
    console.log(
      problems.length === 0
        ? `ok: ${String(records.length)} puzzles verified`
        : `${String(problems.length)} problems in ${String(records.length)} puzzles`,
    );
    return problems.length === 0 ? 0 : 1;
  }

  if (command === 'stats') {
    const fileArg = positional[1];
    if (fileArg === undefined) throw new Error('stats needs a file');
    const file = userPath(fileArg);
    const records = parseRecords(readFileSync(file, 'utf8'));
    const side = statsPath(file);
    const report = existsSync(side)
      ? (JSON.parse(readFileSync(side, 'utf8')) as GenerationReport)
      : null;
    console.log(formatStats(records, report));
    const samples = intFlag(flags, 'samples', 0);
    if (samples > 0) console.log(`\nSamples:\n${formatSamples(records, samples)}`);
    return 0;
  }

  console.log(usage());
  return command === undefined || command === 'help' ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
