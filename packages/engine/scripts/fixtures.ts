// pnpm --filter @retrograde/engine fixtures
//
// Writes fixtures/replay-vectors.json (SPEC §11.2): seeded random legal games with their final
// target key, plus games with one illegal move injected and the index of that move. The Go API
// replays the same vectors with its own chess library, so the two rule sets stay in agreement.
// Regenerate whenever the engine's move rules change.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_VERSION,
  createRng,
  legalMoves,
  moveToUci,
  replay,
  squareName,
  targetKey,
  type Position,
  type Rng,
} from '../src/index';
import { isCastle, isEnPassant, isPromotion, movePromotion } from '../src/core/move';
import { MAX_MOVES, generatePseudoMoves } from '../src/core/movegen';
import { playRandomGame } from '../src/util/random-game';

const SEED = 20261022;
const LEGAL_GAMES = 520;
const ILLEGAL_GAMES = 120;
const OUT = fileURLToPath(new URL('../../../fixtures/replay-vectors.json', import.meta.url));

interface LegalVector {
  moves: string[];
  finalKey: string;
}
interface IllegalVector {
  moves: string[];
  illegalAt: number;
  kind: string;
}

const rng = createRng(SEED);
const coverage = { castles: 0, enPassant: 0, promotions: 0, underpromotions: 0 };

const legal: LegalVector[] = [];
for (let i = 0; i < LEGAL_GAMES; i++) {
  const { moves, position } = playRandomGame(rng, 1 + rng.nextInt(160));
  for (const m of moves) {
    if (isCastle(m)) coverage.castles++;
    if (isEnPassant(m)) coverage.enPassant++;
    if (isPromotion(m)) coverage.promotions++;
    if (isPromotion(m) && movePromotion(m) !== 5) coverage.underpromotions++;
  }
  legal.push({ moves: moves.map(moveToUci), finalKey: targetKey(position) });
}

/** Position after the first `n` moves of a game. */
function positionAfter(moves: readonly string[], n: number): Position {
  const r = replay(moves.slice(0, n));
  if (!r.ok) throw new Error('generated game must replay');
  return r.value;
}

/** The value, or a clear error if a lookup that can't miss did. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function pick<T>(items: readonly T[], r: Rng): T {
  return must(items[r.nextInt(items.length)], 'item');
}

/** Well-formed UCI moves that are illegal in `p`, grouped by why. */
function illegalCandidates(p: Position, earlier: Position | null): Map<string, string[]> {
  const legalUcis = new Set(legalMoves(p).map(moveToUci));
  const kinds = new Map<string, string[]>();
  const add = (kind: string, uci: string) => {
    if (legalUcis.has(uci)) return;
    kinds.set(kind, [...(kinds.get(kind) ?? []), uci]);
  };

  // Pseudo-legal moves that would leave the mover's own king in check.
  const buffer = new Int32Array(MAX_MOVES);
  const n = generatePseudoMoves(p, buffer);
  for (const m of buffer.subarray(0, n)) add('self-check', moveToUci(m));

  // Castling that isn't allowed (no right, blocked, or out of / through / into check).
  const home = p.turn === 0 ? 'e1' : 'e8';
  const rank = p.turn === 0 ? '1' : '8';
  const kingCode = p.turn === 0 ? 6 : -6;
  if (p.board[p.turn === 0 ? 4 : 0x74] === kingCode) {
    add('castling', `${home}g${rank}`);
    add('castling', `${home}c${rank}`);
  }

  // A move of ours that was legal two plies ago but isn't now.
  if (earlier !== null) for (const m of legalMoves(earlier)) add('stale', moveToUci(m));

  for (const m of legalMoves(p)) {
    const uci = moveToUci(m);
    if (isPromotion(m)) add('missing-promotion', uci.slice(0, 4));
    else add('needless-promotion', `${uci}q`);
  }

  // A piece of ours to a square it can't reach.
  for (let attempt = 0; attempt < 20; attempt++) {
    const from = rng.nextInt(128);
    const to = rng.nextInt(128);
    if ((from & 0x88) !== 0 || (to & 0x88) !== 0 || from === to) continue;
    const piece = must(p.board[from], 'square');
    if (piece === 0 || piece > 0 !== (p.turn === 0)) continue;
    add('unreachable', squareName(from) + squareName(to));
  }
  return kinds;
}

const illegal: IllegalVector[] = [];
while (illegal.length < ILLEGAL_GAMES) {
  const { moves } = playRandomGame(rng, 2 + rng.nextInt(120));
  if (moves.length < 2) continue;
  const ucis = moves.map(moveToUci);
  const at = rng.nextInt(ucis.length);
  const p = positionAfter(ucis, at);
  const earlier = at >= 2 ? positionAfter(ucis, at - 2) : null;
  const kinds = illegalCandidates(p, earlier);
  if (kinds.size === 0) continue;
  // Prefer the kind used least so far, so rare kinds (like a missing promotion piece) appear.
  const used = (k: string) => illegal.filter((v) => v.kind === k).length;
  const available = [...kinds.keys()].sort();
  const fewest = Math.min(...available.map(used));
  const kind = pick(
    available.filter((k) => used(k) === fewest),
    rng,
  );
  const bad = pick(must(kinds.get(kind), kind), rng);
  const vector = { moves: [...ucis.slice(0, at), bad, ...ucis.slice(at + 1)], illegalAt: at, kind };
  const check = replay(vector.moves);
  if (check.ok || check.error.illegalAt !== at)
    throw new Error(`bad vector ${JSON.stringify(vector)}`);
  illegal.push(vector);
}

// A missing promotion piece only arises where a promotion is legal, which random plies rarely
// hit, so take those from promotions actually played in the legal games.
for (const v of legal) {
  if (illegal.filter((x) => x.kind === 'missing-promotion').length >= 12) break;
  const at = v.moves.findIndex((u) => u.length === 5);
  if (at < 0) continue;
  const moves = [...v.moves];
  moves[at] = must(moves[at], 'move').slice(0, 4);
  const check = replay(moves);
  if (check.ok || check.error.illegalAt !== at) throw new Error('bad missing-promotion vector');
  illegal.push({ moves, illegalAt: at, kind: 'missing-promotion' });
}

for (const v of legal) {
  const r = replay(v.moves);
  if (!r.ok || targetKey(r.value) !== v.finalKey) throw new Error('legal vector must replay');
}
for (const [name, count] of Object.entries(coverage)) {
  if (count < 10) throw new Error(`too few ${name} in the legal games (${String(count)})`);
}

// One game per line keeps diffs readable.
const lines = [
  '{',
  `  "description": "Generated by pnpm --filter @retrograde/engine fixtures. Do not edit. Legal games end in finalKey (placement + side to move); illegal games have one illegal move at illegalAt.",`,
  `  "engineVersion": ${JSON.stringify(ENGINE_VERSION)},`,
  `  "seed": ${String(SEED)},`,
  '  "legal": [',
  legal.map((v) => `    ${JSON.stringify(v)}`).join(',\n'),
  '  ],',
  '  "illegal": [',
  illegal.map((v) => `    ${JSON.stringify(v)}`).join(',\n'),
  '  ]',
  '}',
  '',
];
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'));

const kindCounts = new Map<string, number>();
for (const v of illegal) kindCounts.set(v.kind, (kindCounts.get(v.kind) ?? 0) + 1);
console.log(`wrote ${OUT}`);
console.log(`legal games: ${String(legal.length)}, coverage: ${JSON.stringify(coverage)}`);
console.log(
  `illegal games: ${String(illegal.length)}, kinds: ${JSON.stringify(Object.fromEntries(kindCounts))}`,
);
