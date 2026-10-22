import {
  analyzePosition,
  clonePosition,
  createRng,
  initialPosition,
  legalMoves,
  makeMove,
  moveToUci,
  retractions,
  toFen,
  unmakeMove,
  type Position,
} from '../../src/index';
import { isCastle, isEnPassant, type Move } from '../../src/core/move';
import { computeHash } from '../../src/core/zobrist';
import { playRandomGame } from '../../src/util/random-game';

export interface RetroStats {
  positions: number;
  moves: number;
  retractionsChecked: number;
  enPassant: number;
  castles: number;
  promotions: number;
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Whether the retracted prior P′ is the true prior P with only the unknowable details left out
 * (see docs/learning/phase-2.md): same placement and side to move; P′'s castling rights are a
 * subset of P's (exactly the rights that survived into Q, plus the one used when castling);
 * P′ has P's en passant square if m captured en passant, and none otherwise. Clocks are ignored.
 */
export function matchesTruePrior(
  retracted: Position,
  truePrior: Position,
  m: Move,
  q: Position,
): boolean {
  for (let i = 0; i < 128; i++) if (retracted.board[i] !== truePrior.board[i]) return false;
  if (retracted.turn !== truePrior.turn) return false;
  if ((retracted.castling & ~truePrior.castling) !== 0) return false;
  // Exactly what a retraction can know: Q's rights plus the right a castling move used.
  if ((retracted.castling & q.castling) !== q.castling) return false;
  if (isEnPassant(m)) return retracted.epSquare === truePrior.epSquare;
  return retracted.epSquare === -1;
}

/** Q with its en passant and/or castling fields cleared, as many FENs write them. */
function stripped(q: Position, clearEp: boolean, clearCastling: boolean): Position {
  const copy = clonePosition(q);
  if (clearEp) copy.epSquare = -1;
  if (clearCastling) copy.castling = 0;
  const hash = computeHash(copy);
  copy.hashHi = hash.hi;
  copy.hashLo = hash.lo;
  return copy;
}

/**
 * Soundness, checked independently of the retraction code: the full legal move list of the
 * prior position must contain a move that gives Q (placement, side, Q's stated en passant
 * square, and every castling right Q states).
 */
function checkSound(q: Position, seed: number): number {
  let checked = 0;
  for (const r of retractions(q)) {
    checked++;
    const prior = r.prior;
    // The full legal move list (not the retraction code's own check) must contain the move.
    const m = legalMoves(prior).find((x) => moveToUci(x) === r.move);
    let found = false;
    if (m !== undefined) {
      makeMove(prior, m);
      found = prior.turn === q.turn && (prior.castling & q.castling) === q.castling;
      for (let i = 0; found && i < 128; i++) found = prior.board[i] === q.board[i];
      if (q.epSquare !== -1) found = found && prior.epSquare === q.epSquare;
      unmakeMove(prior);
    }
    if (!found)
      fail(
        `seed ${String(seed)}: unsound retraction ${r.move} (${r.kind}) of ${toFen(q)}: prior ${toFen(prior)}`,
      );
  }
  return checked;
}

/**
 * Plays a seeded random game. In each position P reached, checks soundness for every
 * retraction of P, and, for every legal move m from P to Q, completeness for Q as played,
 * Q with "-" for en passant and Q with "-" for castling (when Q states those fields).
 */
export function checkRetroGame(seed: number, maxPlies: number): RetroStats {
  const stats: RetroStats = {
    positions: 0,
    moves: 0,
    retractionsChecked: 0,
    enPassant: 0,
    castles: 0,
    promotions: 0,
  };
  playRandomGame(createRng(seed), maxPlies, (p) => {
    stats.positions++;
    // Soundness: every visited position is itself the result of a played move.
    stats.retractionsChecked += checkSound(p, seed);
    const truePrior = clonePosition(p);
    for (const m of legalMoves(p)) {
      stats.moves++;
      const uci = moveToUci(m);
      if (isEnPassant(m)) stats.enPassant++;
      if (isCastle(m)) stats.castles++;
      makeMove(p, m);
      const q = clonePosition(p);
      unmakeMove(p);
      if (uci.length === 5) stats.promotions++;
      for (const [clearEp, clearCastling] of [
        [false, false],
        [true, false],
        [false, true],
      ] as const) {
        // A cleared field only matters when Q states it; otherwise the form is Q itself.
        if ((clearEp && q.epSquare === -1) || (clearCastling && q.castling === 0)) continue;
        const target = stripped(q, clearEp, clearCastling);
        const found = retractions(target).some(
          (r) => r.move === uci && matchesTruePrior(r.prior, truePrior, m, target),
        );
        if (!found) {
          fail(
            `seed ${String(seed)}: incomplete: ${uci} from ${toFen(truePrior)} to ${toFen(target)} has no matching retraction`,
          );
        }
      }
    }
  });
  return stats;
}

/**
 * Runs checkRetroGame over consecutive seeds from `firstSeed` until at least `positions`
 * positions have been checked. Returns the combined statistics.
 */
export function runRetroProperty(firstSeed: number, positions: number, maxPlies = 100): RetroStats {
  const total: RetroStats = {
    positions: 0,
    moves: 0,
    retractionsChecked: 0,
    enPassant: 0,
    castles: 0,
    promotions: 0,
  };
  for (let seed = firstSeed; total.positions < positions; seed++) {
    const s = checkRetroGame(seed, maxPlies);
    for (const key of Object.keys(total) as (keyof RetroStats)[]) total[key] += s[key];
  }
  return total;
}

/**
 * Plays a seeded random game, then checks analyzePosition's claims on every position reached
 * (as played, and with "-" for en passant and castling): never illegal, and a LAST_MOVE_FORCED
 * finding names the move that was actually played. Returns the number of positions checked.
 */
export function checkAnalyzerClaims(seed: number, maxPlies: number, depth: number): number {
  const { moves } = playRandomGame(createRng(seed), maxPlies);
  const p = initialPosition();
  for (const m of moves) {
    const played = moveToUci(m);
    makeMove(p, m);
    for (const [clearEp, clearCastling] of [
      [false, false],
      [true, true],
    ] as const) {
      const q = stripped(p, clearEp, clearCastling);
      const report = analyzePosition(q, { depth, nodeLimit: 20_000, timeLimitMs: 60_000 });
      if (report.verdict.kind === 'illegal') {
        const why = report.verdict.findings.map((f) => f.message).join(' | ');
        fail(`seed ${String(seed)}: ${toFen(q)} called illegal: ${why}`);
      }
      for (const f of report.verdict.findings) {
        if (f.rule === 'LAST_MOVE_FORCED' && f.arrows?.[0]?.join('') !== played.slice(0, 4)) {
          fail(`seed ${String(seed)}: ${toFen(q)}: "${f.message}" but ${played} was played`);
        }
      }
    }
  }
  return moves.length;
}
