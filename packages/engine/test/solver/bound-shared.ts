import {
  createRng,
  initialPosition,
  legalMoves,
  makeMove,
  targetKey,
  toFen,
  unmakeMove,
} from '../../src/index';
import { WHITE } from '../../src/core/board';
import { isCastle, isEnPassant, isPromotion, movePromotion, type Move } from '../../src/core/move';
import type { Position } from '../../src/core/position';
import { createIncrementalBound, createLowerBound } from '../../src/solver/bound';
import { parseTarget } from '../../src/solver/target';
import { playRandomGame } from '../../src/util/random-game';

export interface AdmissibilityStats {
  games: number;
  positions: number;
  castles: number;
  enPassant: number;
  promotions: number;
  /** Games where a side promoted to a type it already had and that original piece was captured later. */
  promotedTwinThenOriginalCaptured: number;
  /** Positions where the incremental bound (search path) was compared with a fresh one. */
  incrementalChecks: number;
}

/**
 * Tracks which pieces are promoted pawns while a game is replayed, to detect the pattern that
 * breaks a forced per-type matching: S promotes to type X while it still has an original X,
 * and that original X is captured later.
 */
function hasPromotedTwinPattern(moves: readonly Move[]): boolean {
  const p = initialPosition();
  const promoted = new Uint8Array(128); // 1 = the piece on this square is a promoted pawn
  // Per side and piece type: does an earlier promotion to that type await its original's capture?
  const waiting = [new Set<number>(), new Set<number>()];
  for (const m of moves) {
    const from = m & 0x7f;
    const to = (m >>> 7) & 0x7f;
    const mover = p.turn;
    const victim = isEnPassant(m) ? 0 : (p.board[to] ?? 0);
    if (victim !== 0 && promoted[to] === 0) {
      const victimSide = victim > 0 ? 0 : 1;
      if (waiting[victimSide]?.has(Math.abs(victim)) === true) return true;
    }
    if (isPromotion(m)) {
      const type = movePromotion(m);
      const sign = mover === WHITE ? 1 : -1;
      let hasOriginal = false;
      for (let sq = 0; sq < 128; sq++) {
        if ((sq & 0x88) === 0 && p.board[sq] === sign * type && promoted[sq] === 0)
          hasOriginal = true;
      }
      if (hasOriginal) waiting[mover]?.add(type);
    }
    // The moving piece carries its flag; a promotion makes it a promoted piece. (Castling rooks
    // are originals, so leaving their flag at 0 is right.)
    promoted[to] = (promoted[from] ?? 0) === 1 || isPromotion(m) ? 1 : 0;
    promoted[from] = 0;
    makeMove(p, m);
  }
  return false;
}

/**
 * Plays seeded random games and checks, for every prefix position, that each side's lower
 * bound to the game's final target is at most that side's remaining moves (SPEC §6.3). In the
 * first `incrementalGames` games it also checks the search's incremental bound against it.
 */
export function checkAdmissibility(
  firstSeed: number,
  games: number,
  incrementalGames = 0,
): AdmissibilityStats {
  const stats: AdmissibilityStats = {
    games: 0,
    positions: 0,
    castles: 0,
    enPassant: 0,
    promotions: 0,
    promotedTwinThenOriginalCaptured: 0,
    incrementalChecks: 0,
  };
  for (let seed = firstSeed; seed < firstSeed + games; seed++) {
    const rng = createRng(seed);
    const { moves, position } = playRandomGame(rng, 1 + rng.nextInt(140));
    const parsed = parseTarget(targetKey(position));
    if (!parsed.ok) throw new Error(parsed.error);
    const bound = createLowerBound(parsed.value);
    // The search's incremental bound follows the game with push, and at every third position
    // also tries one other move (push, compare, pop), so pop is checked too.
    const inc = createIncrementalBound(parsed.value);
    const out = new Int32Array(2);
    const incremental = (q: Position): string =>
      JSON.stringify(inc.evaluate(q, out) ? { white: out[0], black: out[1] } : null);
    const checkIncremental = seed < firstSeed + incrementalGames;
    const sameAsFresh = (q: Position, where: string): void => {
      if (!checkIncremental) return;
      stats.incrementalChecks++;
      const fresh = JSON.stringify(bound(q));
      if (incremental(q) !== fresh) {
        throw new Error(
          `seed ${String(seed)}, ${where}: incremental ${incremental(q)} != fresh ${fresh} at ${toFen(q)}`,
        );
      }
    };
    stats.games++;
    if (moves.some(isCastle)) stats.castles++;
    if (moves.some(isEnPassant)) stats.enPassant++;
    if (moves.some(isPromotion)) stats.promotions++;
    if (hasPromotedTwinPattern(moves)) stats.promotedTwinThenOriginalCaptured++;

    const p: Position = initialPosition();
    inc.reset(p);
    for (let i = 0; i <= moves.length; i++) {
      sameAsFresh(p, `ply ${String(i)}`);
      const others = checkIncremental && i % 3 === 0 ? legalMoves(p) : [];
      const other = others[rng.nextInt(Math.max(1, others.length))];
      if (other !== undefined) {
        makeMove(p, other);
        inc.push(p, other);
        sameAsFresh(p, `ply ${String(i)} + side move`);
        inc.pop();
        unmakeMove(p);
      }
      const remaining = moves.length - i;
      const whiteLeft = p.turn === WHITE ? Math.ceil(remaining / 2) : Math.floor(remaining / 2);
      const blackLeft = remaining - whiteLeft;
      const h = bound(p);
      stats.positions++;
      if (h === null || h.white > whiteLeft || h.black > blackLeft) {
        throw new Error(
          `seed ${String(seed)}, ply ${String(i)}: bound ${JSON.stringify(h)} exceeds remaining ` +
            `white ${String(whiteLeft)} / black ${String(blackLeft)} from ${toFen(p)} to ${targetKey(position)}`,
        );
      }
      const m = moves[i];
      if (m !== undefined) {
        makeMove(p, m);
        if (checkIncremental) inc.push(p, m);
      }
    }
  }
  return stats;
}
