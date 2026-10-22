import { ENGINE_VERSION } from '@retrograde/engine';
import { difficultyScore } from './difficulty';
import { countFeatures, featureTags, type Feature } from './features';
import { describeGame } from './moves';

/** One generated puzzle: one JSON object per line of the output (SPEC §7.4). */
export interface PuzzleRecord {
  id: string;
  plies: number;
  target: string;
  solution: string[];
  features: Feature[];
  /** Stars, 1-5, by rank of `score` in the pool. */
  difficulty: number;
  score: number;
  /** Nodes of the uniqueness count at `plies` (see Verification.solverNodes). */
  solverNodes: number;
  engineVersion: string;
  seed: number;
}

export function puzzleId(seed: number, index: number): string {
  return `g${String(seed)}-${String(index).padStart(6, '0')}`;
}

/** A record without its stars (they depend on the whole pool). */
export function describePuzzle(
  seed: number,
  index: number,
  solution: readonly string[],
  target: string,
  solverNodes: number,
): Omit<PuzzleRecord, 'difficulty'> {
  const counts = countFeatures(describeGame(solution));
  return {
    id: puzzleId(seed, index),
    plies: solution.length,
    target,
    solution: [...solution],
    features: featureTags(counts),
    score: difficultyScore(solution.length, counts, solverNodes),
    solverNodes,
    engineVersion: ENGINE_VERSION,
    seed,
  };
}

/** The JSONL line for a record, with the keys in the documented order. */
export function formatRecord(r: PuzzleRecord): string {
  return JSON.stringify({
    id: r.id,
    plies: r.plies,
    target: r.target,
    solution: r.solution,
    features: r.features,
    difficulty: r.difficulty,
    score: r.score,
    solverNodes: r.solverNodes,
    engineVersion: r.engineVersion,
    seed: r.seed,
  });
}

function fail(line: number, message: string): never {
  throw new Error(`line ${String(line)}: ${message}`);
}

/** Parses a JSONL file of puzzles, checking every field's type. Throws with the line number. */
export function parseRecords(text: string): PuzzleRecord[] {
  const records: PuzzleRecord[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      fail(line, 'not valid JSON');
    }
    if (typeof value !== 'object' || value === null) fail(line, 'not a JSON object');
    const o = value as Record<string, unknown>;
    const str = (k: string): string =>
      typeof o[k] === 'string' ? o[k] : fail(line, `${k} must be a string`);
    const num = (k: string): number =>
      typeof o[k] === 'number' && Number.isFinite(o[k])
        ? o[k]
        : fail(line, `${k} must be a number`);
    const strings = (k: string): string[] => {
      const v = o[k];
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? v
        : fail(line, `${k} must be an array of strings`);
    };
    records.push({
      id: str('id'),
      plies: num('plies'),
      target: str('target'),
      solution: strings('solution'),
      features: strings('features') as Feature[],
      difficulty: num('difficulty'),
      score: num('score'),
      solverNodes: num('solverNodes'),
      engineVersion: str('engineVersion'),
      seed: num('seed'),
    });
  });
  return records;
}
