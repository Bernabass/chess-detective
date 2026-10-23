import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRecords } from '../src/commands';
import { parseRecords } from '../src/puzzle';
import { checkFourPlyTargets } from './brute-force';

describe('generator (slow)', () => {
  it('verifyCandidate agrees with brute force on every 30th 4-ply target', () => {
    const { checked, accepted } = checkFourPlyTargets(30);
    expect(checked).toBeGreaterThan(2300);
    expect(accepted).toBeGreaterThan(100);
  });

  it('every puzzle of the committed pool passes verify', async () => {
    const pool = parseRecords(
      readFileSync(new URL('../../../data/puzzles-v1.jsonl', import.meta.url), 'utf8'),
    );
    expect(pool).toHaveLength(500);
    expect(await checkRecords(pool, 4, 200_000)).toEqual([]);
  });
});
