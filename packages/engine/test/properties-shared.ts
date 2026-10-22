import {
  createRng,
  initialPosition,
  legalMoves,
  makeMove,
  moveToSan,
  moveToUci,
  parseFen,
  sanToMove,
  toFen,
  uciToMove,
  unmakeMove,
  type Move,
  type Position,
} from '../src/index';
import { isCapture, isCastle, isEnPassant, isPromotion } from '../src/core/move';
import { computeHash } from '../src/core/zobrist';

export interface GameStats {
  positions: number;
  castles: number;
  enPassants: number;
  promotions: number;
}

/** Everything make/unmake must restore, as one comparable string. */
function snapshot(p: Position): string {
  return [
    p.board.join(','),
    p.turn,
    p.castling,
    p.epSquare,
    p.halfmove,
    p.fullmove,
    p.kingSquare.join(','),
    p.counts.join(','),
    p.hashHi,
    p.hashLo,
    p.ply,
  ].join('|');
}

/** Plain assertions: building a vitest expectation per legal move is far slower than the engine. */
function check(condition: boolean, message: () => string): void {
  if (!condition) throw new Error(message());
}

/** Random play favouring the special moves, so properties are exercised on them often. */
function weight(m: Move): number {
  if (isEnPassant(m)) return 40;
  if (isCastle(m)) return 20;
  if (isPromotion(m)) return 10;
  if (isCapture(m)) return 3;
  return 1;
}

function pick(moves: readonly Move[], rng: ReturnType<typeof createRng>): Move {
  let total = 0;
  for (const m of moves) total += weight(m);
  let r = rng.nextFloat() * total;
  for (const m of moves) {
    r -= weight(m);
    if (r < 0) return m;
  }
  throw new Error('unreachable: the weights add up to total');
}

/**
 * Plays one seeded random game and checks, in every position reached:
 * FEN round-trip; make+unmake restores everything for every legal move; the incremental hash
 * equals a from-scratch hash after every move; SAN and UCI round-trip for every legal move.
 */
export function checkRandomGame(seed: number, maxPlies: number, startFen?: string): GameStats {
  const rng = createRng(seed);
  let p = initialPosition();
  if (startFen !== undefined) {
    const parsed = parseFen(startFen);
    if (!parsed.ok) throw new Error(`bad start FEN ${startFen}`);
    p = parsed.value;
  }
  const stats: GameStats = { positions: 0, castles: 0, enPassants: 0, promotions: 0 };

  for (let ply = 0; ply < maxPlies; ply++) {
    stats.positions++;
    const text = toFen(p);
    const parsed = parseFen(text);
    check(parsed.ok && toFen(parsed.value) === text, () => `FEN round-trip failed for ${text}`);
    check(
      parsed.ok && parsed.value.hashHi === p.hashHi && parsed.value.hashLo === p.hashLo,
      () => `parsed hash differs from played hash for ${text}`,
    );

    const moves = legalMoves(p);
    if (moves.length === 0) break;

    const before = snapshot(p);
    for (const m of moves) {
      const uci = moveToUci(m);
      const fromUci = uciToMove(p, uci);
      check(fromUci.ok && fromUci.value === m, () => `UCI ${uci} doesn't round-trip in ${text}`);
      const san = moveToSan(p, m);
      const fromSan = sanToMove(p, san);
      check(fromSan.ok && fromSan.value === m, () => `SAN ${san} doesn't round-trip in ${text}`);

      makeMove(p, m);
      const fresh = computeHash(p);
      check(
        p.hashHi === fresh.hi && p.hashLo === fresh.lo,
        () => `incremental hash differs from recomputed hash after ${uci} in ${text}`,
      );
      unmakeMove(p);
      check(snapshot(p) === before, () => `unmakeMove(${uci}) didn't restore ${text}`);
    }

    const chosen = pick(moves, rng);
    if (isCastle(chosen)) stats.castles++;
    if (isEnPassant(chosen)) stats.enPassants++;
    if (isPromotion(chosen)) stats.promotions++;
    makeMove(p, chosen);
  }
  return stats;
}
