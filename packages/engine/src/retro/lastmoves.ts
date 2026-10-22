import { WHITE } from '../core/board';
import { START_FEN, parseFen, toFen } from '../core/fen';
import type { Position } from '../core/position';
import { retractionDescription, retractionNotation } from './describe';
import { retractions, type Retraction, type RetractionKind } from './retract';
import { hasStaticContradiction } from './rules';

/**
 * `viable`: the retraction survives the requested depth. `not-viable`: it definitely doesn't.
 * `unknown`: a time, node or stop limit cut the search short, so nothing can be claimed.
 */
export type Viability = 'viable' | 'not-viable' | 'unknown';

export interface LastMove {
  /** The forward move in UCI, e.g. "e7e5". */
  move: string;
  kind: RetractionKind;
  /** FEN letter of the piece the move captured, or null. */
  uncaptured: string | null;
  /** Long algebraic, e.g. "Bf1xb5" or "…e7-e5". */
  notation: string;
  /** "White's last move could have been Bf1xb5, capturing a black knight." */
  description: string;
  /** FEN of the position before the move. */
  prior: string;
  /** Whether the prior position passes every static rule (viability at depth 1). */
  possible: boolean;
  /** Viability at the requested depth. */
  viability: Viability;
}

export interface LastMovesOptions {
  /** How many moves back to check (default 1). */
  depth?: number;
  timeLimitMs?: number;
  /** Most retraction generations to spend on depths beyond 1. */
  nodeLimit?: number;
  /** Polled once per retraction generation; return true to stop. */
  shouldStop?: () => boolean;
}

export interface LastMovesResult {
  moves: LastMove[];
  depth: number;
  /** `limit`/`aborted`: some viabilities are `unknown`. */
  status: 'complete' | 'limit' | 'aborted';
  /** Retraction generations spent on depths beyond 1. */
  nodes: number;
  elapsedMs: number;
}

const INITIAL_BOARD = (() => {
  const r = parseFen(START_FEN);
  if (!r.ok) throw new Error('START_FEN must parse');
  return r.value.board;
})();

/** The initial placement with White to move (castling and en passant aren't compared). */
export function isInitialPlacement(p: Position): boolean {
  if (p.turn !== WHITE) return false;
  for (let i = 0; i < 128; i++) if (p.board[i] !== INITIAL_BOARD[i]) return false;
  return true;
}

/** Exact cache key: placement, side, castling and en passant. Never the hash alone. */
function exactKey(p: Position): string {
  return toFen(p).split(' ', 4).join(' ');
}

/**
 * Every possible last move of `p` (each depth-1 retraction) with its viability at
 * `opts.depth` (SPEC §5.4). A retraction to P′ is viable at depth k if P′ passes every static
 * rule and k = 1, or P′ is the initial position, or P′ has a retraction viable at depth k − 1.
 */
export function lastMoves(p: Position, opts: LastMovesOptions = {}): LastMovesResult {
  const depth = Math.max(1, Math.floor(opts.depth ?? 1));
  const nodeLimit = opts.nodeLimit ?? Infinity;
  const timeLimit = opts.timeLimitMs ?? Infinity;
  const start = Date.now();
  let nodes = 0;
  let status: LastMovesResult['status'] = 'complete';
  const memo = new Map<string, Viability>();

  /** Whether the search must stop now; records why the first time. */
  const stopped = (): boolean => {
    if (status !== 'complete') return true;
    if (nodes >= nodeLimit || Date.now() - start > timeLimit) status = 'limit';
    else if (opts.shouldStop?.() === true) status = 'aborted';
    return status !== 'complete';
  };

  const viable = (prior: Position, k: number): Viability => {
    if (hasStaticContradiction(prior)) return 'not-viable';
    if (k <= 1 || isInitialPlacement(prior)) return 'viable';
    const key = `${exactKey(prior)}#${String(k)}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (stopped()) return 'unknown';
    nodes++;
    let sawUnknown = false;
    for (const r of retractions(prior)) {
      const v = viable(r.prior, k - 1);
      if (v === 'viable') {
        memo.set(key, 'viable');
        return 'viable';
      }
      if (v === 'unknown') sawUnknown = true;
    }
    if (sawUnknown) return 'unknown'; // not cached: a later search may have more budget
    memo.set(key, 'not-viable');
    return 'not-viable';
  };

  const moves = retractions(p).map((r: Retraction): LastMove => {
    const possible = !hasStaticContradiction(r.prior);
    return {
      move: r.move,
      kind: r.kind,
      uncaptured: r.uncaptured,
      notation: retractionNotation(r),
      description: retractionDescription(r),
      prior: toFen(r.prior),
      possible,
      viability: possible ? viable(r.prior, depth) : 'not-viable',
    };
  });
  return { moves, depth, status, nodes, elapsedMs: Date.now() - start };
}
