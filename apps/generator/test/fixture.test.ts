import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRecords, formatSamples, formatStats } from '../src/commands';
import { parseRecords } from '../src/puzzle';

// 20 puzzles cut from data/puzzles-v1.jsonl by scripts/make-fixture.ts. If an engine change
// breaks any of them (no longer unique, or no longer shortest), this fails.
const fixture = parseRecords(
  readFileSync(new URL('./fixtures/puzzles-20.jsonl', import.meta.url), 'utf8'),
);

describe('committed puzzle fixture', () => {
  it('passes verify: replays, unique, shortest, same features, score and stars', async () => {
    expect(fixture).toHaveLength(20);
    expect(await checkRecords(fixture, 1, 200_000)).toEqual([]);
  }, 60_000);

  it('summarizes with stats and samples', () => {
    const text = formatStats(fixture, null);
    expect(text).toContain('20 puzzles');
    const samples = formatSamples(fixture, 2);
    expect(samples).toContain('★★★★★');
    expect(samples).toMatch(/solution 1\.\S+ \S+ 2\./);
  });

  it('rejects malformed lines with their line number', () => {
    expect(() => parseRecords('{"id":"x"}\n')).toThrow(/line 1: plies must be a number/);
    expect(() => parseRecords('\nnot json')).toThrow(/line 2: not valid JSON/);
  });
});
