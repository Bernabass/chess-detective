// Cuts the committed verify fixture (test/fixtures/puzzles-20.jsonl) from a generated pool:
// 18 puzzles of at most 8 plies and 3,000 solver nodes spread over the pool's scores, plus the
// cheapest-to-solve 11- and 12-ply puzzles (so the long end is covered and verifying stays
// fast), with stars re-ranked within the fixture itself (stars are always relative to the file).
//   npx tsx scripts/make-fixture.ts ../../data/puzzles-v1.jsonl
import { readFileSync, writeFileSync } from 'node:fs';
import { assignStars } from '../src/difficulty';
import { formatRecord, parseRecords } from '../src/puzzle';

const source = process.argv[2];
if (source === undefined) throw new Error('usage: make-fixture.ts <pool.jsonl>');
const all = parseRecords(readFileSync(source, 'utf8'));
const cheapest = (plies: number) =>
  all
    .filter((r) => r.plies === plies)
    .sort((a, b) => a.solverNodes - b.solverNodes || (a.id < b.id ? -1 : 1))[0];
const long = [cheapest(11), cheapest(12)].filter((r) => r !== undefined);
const short = all
  .filter((r) => r.plies <= 8 && r.solverNodes <= 3000)
  .sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
const picked = Array.from(
  { length: 18 },
  (_, k) => short[Math.floor(((k + 0.5) * short.length) / 18)],
)
  .filter((r) => r !== undefined)
  .concat(long)
  .sort((a, b) => (a.id < b.id ? -1 : 1));
const stars = assignStars(picked);
const lines = picked.map((r, i) => `${formatRecord({ ...r, difficulty: stars[i] ?? 0 })}\n`);
writeFileSync(new URL('../test/fixtures/puzzles-20.jsonl', import.meta.url), lines.join(''));
console.log(`wrote ${String(lines.length)} puzzles`);
