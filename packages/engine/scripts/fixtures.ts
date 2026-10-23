// pnpm --filter @retrograde/engine fixtures
//
// Writes the cross-language fixtures (SPEC §11.2):
// - fixtures/replay-vectors.json: seeded random legal games with their final target key and the
//   SAN of every move, plus games with one illegal move injected and the index of that move. The
//   Go API replays the same vectors with its own chess library, so the two rule sets (and their
//   SAN) stay in agreement. Regenerate whenever the engine's move rules change.
// - fixtures/feedback-vectors.json: daily-puzzle feedback (SPEC §8.3) from the reference
//   implementation below; the Go server must produce the same strings.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_VERSION,
  createRng,
  legalMoves,
  moveToSan,
  moveToUci,
  replay,
  squareName,
  targetKey,
  type Position,
  type Rng,
} from '../src/index';
import { makeMove } from '../src/core/makemove';
import { isCastle, isEnPassant, isPromotion, movePromotion } from '../src/core/move';
import { MAX_MOVES, generatePseudoMoves } from '../src/core/movegen';
import { playRandomGame } from '../src/util/random-game';

const SEED = 20261022;
const LEGAL_GAMES = 520;
const ILLEGAL_GAMES = 120;
const OUT = fileURLToPath(new URL('../../../fixtures/replay-vectors.json', import.meta.url));
const FEEDBACK_OUT = fileURLToPath(
  new URL('../../../fixtures/feedback-vectors.json', import.meta.url),
);

interface LegalVector {
  moves: string[];
  finalKey: string;
  san?: string[];
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

// SAN of every move (added after generation, so the random sequence above is unchanged). Hint 3
// of the daily puzzle shows a move in SAN from the Go library; the web app writes SAN with the
// engine. The Go test checks they agree.
for (const v of legal) {
  const p = positionAfter([], 0);
  v.san = v.moves.map((u) => {
    const m = must(
      legalMoves(p).find((x) => moveToUci(x) === u),
      u,
    );
    const san = moveToSan(p, m);
    makeMove(p, m);
    return san;
  });
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

// --- Feedback vectors (SPEC §8.3) ---------------------------------------------------------------

/**
 * Reference implementation of the daily feedback: G where the guess move equals the solution move
 * at that ply; otherwise Y if it equals a not-yet-used solution move at another ply of the same
 * colour (leftmost first, plies processed left to right); otherwise X. Greens are assigned first.
 */
function feedback(solution: readonly string[], guess: readonly string[]): string {
  const out: string[] = guess.map((g, i) => (g === solution[i] ? 'G' : 'X'));
  const used = solution.map((s, i) => s === guess[i]);
  guess.forEach((g, i) => {
    if (out[i] === 'G') return;
    for (let j = i % 2; j < solution.length; j += 2) {
      if (j !== i && !used[j] && solution[j] === g) {
        out[i] = 'Y';
        used[j] = true;
        return;
      }
    }
  });
  return out.join('');
}

const split = (s: string): string[] => s.split(' ');
const FEEDBACK_CASES: [string, string, string][] = [
  // [comment, solution, guess]; the first three are SPEC §8.3's table.
  ['SPEC §8.3 example 1', 'e2e4 e7e5 g1f3 g8f6 f3g1 f6g8', 'g1f3 e7e5 e2e4 g8f6 f3g1 b8c6'],
  ['SPEC §8.3 example 2', 'g1f3 g8f6 f3g1 f6g8 g1f3 b8c6', 'g1f3 b8c6 f3g1 c6b8 g1f3 g8f6'],
  ['SPEC §8.3 example 3', 'g1f3 g8f6 f3g1 f6g8 g1f3 b8c6', 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6'],
  ['the solution itself', 'e2e4 e7e5 g1f3 b8c6 f1b5', 'e2e4 e7e5 g1f3 b8c6 f1b5'],
  ['no move in common', 'e2e4 e7e5 g1f3 b8c6 f1b5', 'd2d4 d7d5 c2c4 c7c6 b1c3'],
  ['same moves, swapped within each colour', 'e2e4 e7e5 d2d4 d7d5', 'd2d4 d7d5 e2e4 e7e5'],
  ['a move at a ply of the other colour is gray', 'g1f3 b8c6 b1c3 g8f6', 'b8c6 g1f3 g8f6 b1c3'],
  ['a repeated guess move earns one yellow', 'e2e4 a7a6 d2d4 a6a5', 'd2d4 a7a6 d2d4 a6a5'],
  ['green is assigned before yellow', 'g1f3 g8f6 f3g1 f6g8 g1f3', 'g1f3 g8f6 g1f3 f6g8 g1f3'],
  [
    'leftmost unused solution ply first',
    'g1f3 a7a6 f3g1 a6a5 g1f3 h7h6',
    'f3g1 h7h6 g1f3 a7a6 a2a3 b7b6',
  ],
  ['odd length', 'e2e4 e7e5 d1h5', 'd1h5 e7e5 e2e4'],
  ['one ply', 'e2e4', 'd2d4'],
  ['all yellow', 'a2a3 a7a6 b2b3 b7b6', 'b2b3 b7b6 a2a3 a7a6'],
  ['promotion letters are part of the move', 'a7a8q b2b1n', 'a7a8n b2b1n'],
];
const feedbackVectors = FEEDBACK_CASES.map(([comment, solution, guess]) => ({
  comment,
  solution: split(solution),
  guess: split(guess),
  feedback: feedback(split(solution), split(guess)),
}));
const SPEC_EXPECTED = ['YGYGGX', 'GYGXGY', 'GGGGGX'];
SPEC_EXPECTED.forEach((want, i) => {
  if (feedbackVectors[i]?.feedback !== want) {
    throw new Error(`feedback reference disagrees with SPEC §8.3 example ${String(i + 1)}`);
  }
});
writeFileSync(
  FEEDBACK_OUT,
  [
    '{',
    `  "description": "Generated by pnpm --filter @retrograde/engine fixtures. Do not edit. Daily feedback per SPEC §8.3: G same move at that ply, Y an unused solution move at another ply of the same colour, X otherwise.",`,
    '  "vectors": [',
    feedbackVectors.map((v) => `    ${JSON.stringify(v)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n'),
);
console.log(`wrote ${FEEDBACK_OUT}: ${String(feedbackVectors.length)} feedback vectors`);
