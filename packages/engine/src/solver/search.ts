import {
  BLACK_KINGSIDE,
  BLACK_QUEENSIDE,
  NO_SQUARE,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  squareFromName,
} from '../core/board';
import { initialPosition } from '../core/fen';
import { makeMove, unmakeMove } from '../core/makemove';
import { MAX_MOVES, generateLegalMoves } from '../core/movegen';
import type { Move } from '../core/move';
import type { Position } from '../core/position';
import { moveToUci } from '../core/uci';
import { createIncrementalBound } from './bound';
import { parseTarget, type Target } from './target';
import { acquireTable, releaseTable, type TranspositionTable } from './tt';

export interface SolveOptions {
  /** Exact length of the proof game, in plies. */
  plies: number;
  mode: 'find-one' | 'find-all' | 'count';
  /** Stop counting or collecting once this many are found (default: 1 for find-one, else unlimited). */
  cap?: number;
  timeLimitMs?: number;
  nodeLimit?: number;
  shouldStop?: () => boolean;
  /** About every 50,000 nodes; `plies` is the length being searched. */
  onProgress?: (p: { nodes: number; elapsedMs: number; plies: number }) => void;
  /** Castling rights (subset of "KQkq") that must still hold at the end. */
  castling?: string;
  /** En passant square the final position must have (as written in FEN). */
  enPassant?: string;
  /** Transposition table size: 2^ttBits entries (default 12 + plies, at most 20: about 17 MB). */
  ttBits?: number;
}

export interface SolveResult {
  status: 'complete' | 'limit' | 'aborted';
  /** UCI move sequences found (find modes). */
  solutions: string[][];
  /** Exact if status is complete and count < cap; otherwise a lower bound. */
  count: number;
  nodes: number;
  elapsedMs: number;
}

/**
 * Table size for a search of `plies` plies: 2^(12 + plies) entries, at most 2^20 (about 17 MB:
 * 16 bytes an entry). Short searches stay small. Finished tables go back to a pool (tt.ts) that
 * keeps up to 2 per size for the life of the thread, so later solves reuse them.
 */
export function defaultTtBits(plies: number): number {
  return Math.min(20, 12 + plies);
}

/**
 * How often (in nodes) to check limits, and to report progress. Limits are checked on the first
 * node and every 256 nodes after, far more often than SPEC §6.4's 50,000: a find-mode node
 * evaluates the bound for every child (about 80 us), so even 4,096 nodes could overshoot
 * analyzePosition's 750 ms budget. Date.now() is negligible next to a node.
 */
const CHECK_INTERVAL = 256;
const PROGRESS_INTERVAL = 50_000;

function castlingBits(rights: string): number {
  let bits = 0;
  if (rights.includes('K')) bits |= WHITE_KINGSIDE;
  if (rights.includes('Q')) bits |= WHITE_QUEENSIDE;
  if (rights.includes('k')) bits |= BLACK_KINGSIDE;
  if (rights.includes('q')) bits |= BLACK_QUEENSIDE;
  return bits;
}

/**
 * Finds or counts the games of exactly `opts.plies` plies from the initial position that end in
 * `target` (placement + side to move), SPEC §6.
 *
 * Depth-first search over the exact remaining ply count. A node is pruned when either side's
 * lower bound (§6.3) exceeds the moves that side has left (§6.2). A transposition table keyed by
 * (Zobrist key, remaining plies) remembers subtree counts, saturated at `cap`, so repeated
 * subtrees are looked up instead of searched; in find modes it only remembers dead ends.
 * Results of subtrees cut short by a limit are never stored.
 */
export function solveProofGame(target: string, opts: SolveOptions): SolveResult {
  const parsed = parseTarget(target);
  if (!parsed.ok) throw new Error(parsed.error);
  return solveFrom(initialPosition(), parsed.value, opts);
}

/**
 * solveProofGame for an already-parsed target. shortestProofGame passes one table for all the
 * ply counts it tries: an entry means "solutions from this node with r plies left", which
 * doesn't depend on the total length.
 */
export function solveFrom(
  start: Position,
  t: Target,
  opts: SolveOptions,
  sharedTt?: TranspositionTable,
): SolveResult {
  const startTime = Date.now();
  const plies = Math.max(0, Math.floor(opts.plies));
  const mode = opts.mode;
  const cap = opts.cap ?? (mode === 'find-one' ? 1 : Infinity);
  const nodeLimit = opts.nodeLimit ?? Infinity;
  const timeLimit = opts.timeLimitMs ?? Infinity;
  const required = castlingBits(opts.castling ?? '');
  const requiredEp = opts.enPassant === undefined ? NO_SQUARE : squareFromName(opts.enPassant);
  const tt = sharedTt ?? acquireTable(opts.ttBits ?? defaultTtBits(plies));
  const bound = createIncrementalBound(t);
  bound.reset(start);
  const h = new Int32Array(2);

  const p = start;
  const buffers = Array.from({ length: plies + 1 }, () => new Int32Array(MAX_MOVES));
  const scores = Array.from({ length: plies + 1 }, () => new Float64Array(MAX_MOVES));
  const path: Move[] = [];
  const differs = new Uint8Array(128);
  const solutions: string[][] = [];
  let nodes = 0;
  let nextCheck = 1;
  let nextProgress = PROGRESS_INTERVAL;
  let status: SolveResult['status'] = 'complete';

  const result = (count: number): SolveResult => {
    if (sharedTt === undefined) releaseTable(tt);
    return { status, solutions, count, nodes, elapsedMs: Date.now() - startTime };
  };

  // After an odd number of plies the other side is to move; it must be the target's.
  const finalTurn = plies % 2 === 0 ? start.turn : start.turn === WHITE ? 1 : 0;
  if (finalTurn !== t.turn) return result(0);

  const isTarget = (): boolean => {
    if (p.turn !== t.turn) return false;
    if ((p.castling & required) !== required) return false;
    if (requiredEp !== NO_SQUARE && p.epSquare !== requiredEp) return false;
    const b = p.board;
    const tb = t.board;
    for (let sq = 0; sq < 120; sq++) if (b[sq] !== tb[sq]) return false;
    return true;
  };

  /** Whether the node can still reach the target with `remaining` plies (per-side budgets). */
  const feasible = (remaining: number): boolean => {
    if ((p.castling & required) !== required) return false; // rights never come back
    if (!bound.evaluate(p, h)) return false;
    const toMove = Math.ceil(remaining / 2);
    const other = remaining - toMove;
    const whiteLeft = p.turn === WHITE ? toMove : other;
    const blackLeft = remaining - whiteLeft;
    return h[0]! <= whiteLeft && h[1]! <= blackLeft;
  };

  // A function, not an inline comparison: `status` changes inside recursive calls.
  const stopped = (): boolean => status !== 'complete';

  /** Solutions below this node (saturated at cap). Sets `status` when a limit stops the search. */
  const search = (remaining: number): number => {
    nodes++;
    if (nodes >= nextCheck || nodes >= nodeLimit) {
      nextCheck = nodes + CHECK_INTERVAL;
      const elapsed = Date.now() - startTime;
      if (nodes >= nextProgress) {
        nextProgress = nodes + PROGRESS_INTERVAL;
        opts.onProgress?.({ nodes, elapsedMs: elapsed, plies });
      }
      if (nodes >= nodeLimit || elapsed > timeLimit) status = 'limit';
      else if (opts.shouldStop?.() === true) status = 'aborted';
    }
    if (status !== 'complete') return 0;

    if (remaining === 0) {
      if (!isTarget()) return 0;
      if (mode !== 'count' && solutions.length < cap) solutions.push(path.map(moveToUci));
      return 1;
    }

    // Count mode reuses any stored count; find modes only skip known dead ends (they must
    // still walk a subtree to record its solutions).
    const cached = tt.get(p.hashHi, p.hashLo, remaining);
    if (cached === 0 || (mode === 'count' && cached > 0)) return cached;

    const moves = buffers[remaining]!;
    if (remaining === 1) return lastPly(moves);
    const n = generateLegalMoves(p, moves);
    let order = n;
    if (mode !== 'count') {
      // Score children by their bound (smallest first) and drop infeasible ones up front.
      const score = scores[remaining]!;
      order = 0;
      for (let i = 0; i < n; i++) {
        const m = moves[i]!;
        makeMove(p, m);
        bound.push(p, m);
        const ok = feasible(remaining - 1);
        const s = ok ? h[0]! + h[1]! : 0;
        bound.pop();
        unmakeMove(p);
        if (!ok) continue;
        moves[order] = m;
        score[order] = s;
        order++;
      }
      // Insertion sort: move lists are short.
      for (let i = 1; i < order; i++) {
        const m = moves[i]!;
        const s = score[i]!;
        let j = i - 1;
        while (j >= 0 && score[j]! > s) {
          moves[j + 1] = moves[j]!;
          score[j + 1] = score[j]!;
          j--;
        }
        moves[j + 1] = m;
        score[j + 1] = s;
      }
    }

    let total = 0;
    for (let i = 0; i < order; i++) {
      const m = moves[i]!;
      makeMove(p, m);
      bound.push(p, m);
      if (mode === 'count' && !feasible(remaining - 1)) {
        bound.pop();
        unmakeMove(p);
        continue;
      }
      path.push(m);
      total += search(remaining - 1);
      path.pop();
      bound.pop();
      unmakeMove(p);
      if (stopped()) return total; // cut short: don't store anything
      if (total >= cap) {
        total = cap;
        break;
      }
    }
    // Count mode stores every complete count; find modes only remember dead ends.
    if (mode === 'count' || total === 0) tt.set(p.hashHi, p.hashLo, remaining, total);
    return total;
  };

  /**
   * One ply left: only a move whose start and end squares are both among the squares where the
   * board differs from the target can finish, and one move changes at most 4 squares (castling).
   * Most nodes of an exact-depth search are here, so this skips the bound for every child.
   */
  const lastPly = (moves: Int32Array): number => {
    const b = p.board;
    const tb = t.board;
    let differing = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (b[sq] !== tb[sq]) {
        differs[sq] = 1;
        differing++;
      }
    }
    let total = 0;
    if (differing > 0 && differing <= 4) {
      const n = generateLegalMoves(p, moves);
      for (let i = 0; i < n && total < cap; i++) {
        const m = moves[i]!;
        if (differs[m & 0x7f] !== 1 || differs[(m >>> 7) & 0x7f] !== 1) continue;
        makeMove(p, m);
        if (isTarget()) {
          total++;
          if (mode !== 'count' && solutions.length < cap) {
            path.push(m);
            solutions.push(path.map(moveToUci));
            path.pop();
          }
        }
        unmakeMove(p);
      }
    }
    differs.fill(0);
    if (mode === 'count' || total === 0) tt.set(p.hashHi, p.hashLo, 1, total);
    return total;
  };

  let count = 0;
  if (feasible(plies)) count = search(plies);
  else nodes = 1;
  return result(Math.min(count, cap));
}
