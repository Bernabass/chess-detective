import { targetKey } from '@retrograde/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { replayMoves } from '../src/beam';
import { checkRecords } from '../src/commands';
import { generate, type GenerateOptions } from '../src/generate';
import { describeGame } from '../src/moves';
import { formatRecord, type PuzzleRecord } from '../src/puzzle';
import { randomCandidates } from '../src/random';
import { verifyCandidate } from '../src/verify';

const SMALL: GenerateOptions = {
  count: 12,
  seed: 3,
  minPlies: 3,
  maxPlies: 5,
  jobs: 1,
  source: 'both',
  nodeLimit: 200_000,
  width: 8,
  children: 4,
  random: 30,
};

const jsonl = (puzzles: readonly PuzzleRecord[]): string => puzzles.map(formatRecord).join('\n');

describe('generate', () => {
  let puzzles: PuzzleRecord[] = [];
  beforeAll(async () => {
    puzzles = (await generate(SMALL)).puzzles;
  }, 60_000);

  it('is byte-identical for the same seed, whatever --jobs is', async () => {
    const one = jsonl(puzzles);
    expect(jsonl((await generate({ ...SMALL, jobs: 2 })).puzzles)).toBe(one);
    expect(jsonl((await generate({ ...SMALL, seed: 4 })).puzzles)).not.toBe(one);
  }, 60_000);

  it('stays identical across --jobs when searches hit the node limit', async () => {
    const tight = { ...SMALL, nodeLimit: 40 };
    const result = await generate(tight);
    expect(result.stats.some((s) => s.limit > 0)).toBe(true);
    const again = await generate({ ...tight, jobs: 2 });
    expect(jsonl(again.puzzles)).toBe(jsonl(result.puzzles));
    expect(again.stats.map((s) => s.limit)).toEqual(result.stats.map((s) => s.limit));
  }, 60_000);

  it('produces puzzles that pass verify', async () => {
    expect(puzzles).toHaveLength(SMALL.count);
    // --min-plies 3 must give puzzles shorter than the standard 5-12 quotas too.
    expect(puzzles.some((p) => p.plies < 5)).toBe(true);
    for (const p of puzzles) {
      expect(p.plies).toBeGreaterThanOrEqual(SMALL.minPlies);
      expect(p.plies).toBeLessThanOrEqual(SMALL.maxPlies);
      expect(p.id).toMatch(/^g3-\d{6,}$/);
    }
    expect(await checkRecords(puzzles, 1, SMALL.nodeLimit)).toEqual([]);
  }, 60_000);

  it('verify catches a tampered record', async () => {
    const [first] = puzzles;
    if (first === undefined) throw new Error('no puzzle');
    const swapped = { ...first, solution: [...first.solution].reverse() };
    const wrongScore = { ...first, id: `${first.id}x`, score: first.score + 1 };
    const problems = await checkRecords([swapped, wrongScore], 1, SMALL.nodeLimit);
    expect(problems.some((p) => p.startsWith(first.id))).toBe(true);
    expect(problems.some((p) => p.includes('score'))).toBe(true);
  }, 60_000);
});

describe('prefix property', () => {
  it('drops the last ply of an accepted random game and gets an accepted game', () => {
    // SPEC §7.2: the beam relies on it, so check it on games the beam did not build.
    const games = randomCandidates(11, 120, 3, 5, 0);
    let checked = 0;
    for (const g of games) {
      if (verifyCandidate(g.target, g.moves.length, 200_000).status !== 'accepted') continue;
      const last = describeGame(g.moves).at(-1);
      if (last === undefined || last.castling || last.enPassant) continue;
      const prefix = g.moves.slice(0, -1);
      expect(verifyCandidate(targetKey(replayMoves(prefix)), prefix.length, 200_000).status).toBe(
        'accepted',
      );
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
