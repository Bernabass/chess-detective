import {
  A1,
  A8,
  BLACK,
  BLACK_KINGSIDE,
  BLACK_QUEENSIDE,
  C1,
  C8,
  D1,
  D8,
  E1,
  E8,
  F1,
  F8,
  G1,
  G8,
  H1,
  H8,
  KING,
  PAWN,
  ROOK,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  type Side,
} from '../core/board';
import { FLAG_CASTLE, FLAG_EN_PASSANT, FLAG_PROMOTION, type Move } from '../core/move';
import { UNDO_STRIDE, type Position } from '../core/position';
import {
  K_KING,
  K_PAWN,
  K_ROOK,
  KINDS,
  kindOf,
  obstacleDistance,
  pawnDistance,
  type Target,
} from './target';

/** Minimum moves each side still needs to reach the target (SPEC §6.3). */
export interface Bound {
  white: number;
  black: number;
}

/** Writes [white, black] into `out` and returns true, or returns false if the target is unreachable. */
export type BoundFn = (p: Position, out: Int32Array) => boolean;

/**
 * The bound with its piece lists kept up to date move by move, for the search (SPEC §6.3).
 * Rebuilding the lists from the board at every node was half of the solver's time; a move
 * changes at most three of them (the mover, a captured piece, a castling rook).
 */
export interface IncrementalBound {
  /** Rebuilds the piece lists from `p`. */
  reset: (p: Position) => void;
  /** Call right after makeMove(p, m): updates the lists for that move. */
  push: (p: Position, m: Move) => void;
  /** Call before the matching unmakeMove: restores the lists exactly. */
  pop: () => void;
  /** The bound for `p`, whose lists must be current. */
  evaluate: BoundFn;
}

/** Undo log entries: a piece appended to a list, a piece removed (swapped with the last), a capture. */
const OP_ADD = 0;
const OP_REMOVE = 1;
const OP_CAPTURE = 2;
/** Most undo entries one move writes (castling: 4). */
const OPS_PER_MOVE = 4;

interface CastleInfo {
  right: number;
  kingHome: number;
  kingTo: number;
  rookHome: number;
  rookTo: number;
}

const CASTLES: readonly (readonly CastleInfo[])[] = [
  [
    { right: WHITE_KINGSIDE, kingHome: E1, kingTo: G1, rookHome: H1, rookTo: F1 },
    { right: WHITE_QUEENSIDE, kingHome: E1, kingTo: C1, rookHome: A1, rookTo: D1 },
  ],
  [
    { right: BLACK_KINGSIDE, kingHome: E8, kingTo: G8, rookHome: H8, rookTo: F8 },
    { right: BLACK_QUEENSIDE, kingHome: E8, kingTo: C8, rookHome: A8, rookTo: D8 },
  ],
];

/** Room for up to 64 pieces of one kind per side: more than any position can hold. */
const MAX_PER_KIND = 64;

/**
 * Builds the lower-bound function for one target (SPEC §6.3). For each side S, the bound is the
 * maximum of:
 *  1. displacement: per piece kind, the cheapest way to provide every target piece of S, either
 *     by a distinct current piece of that kind (empty-board distance) or, for non-pawns, as a
 *     promoted pawn at cost 0, at most E = (current pawns - target pawns) times per kind;
 *  2. captures S must make: opponent pieces now minus opponent pieces in the target.
 * It is unreachable (false) when S has fewer pieces than the target, its target pawns can't
 * each get a distinct current pawn, or more target pieces need promoting than E allows.
 *
 * Castling moves king and rook in one move, so while S may still castle, its king may count
 * 1 + distance from its castled square, and the castling rook its distance from its castled
 * square (its own move is free). That keeps the bound admissible (the "castling trap").
 *
 * Allocation-free on cache hits (the common case): the search calls it at every node.
 *
 * Each (side, kind) cost is memoized on its exact inputs: that kind's piece list (identified by
 * a version number that changes whenever the list does), the promotion allowance and, for kings
 * and rooks, which castlings are still available. Sibling nodes in a search usually change one
 * kind of one side, so the other kinds are reused; and because the key is the complete input,
 * the result always equals a from-scratch computation.
 */
export function createBoundFn(t: Target): BoundFn {
  const inc = createIncrementalBound(t);
  return (p, out) => {
    inc.reset(p);
    return inc.evaluate(p, out);
  };
}

/** See IncrementalBound; the bound itself is described at createBoundFn. */
export function createIncrementalBound(t: Target): IncrementalBound {
  // Current pieces: squares[(side * KINDS + kind) * MAX_PER_KIND + i], counts in len.
  const squares = new Int16Array(2 * KINDS * MAX_PER_KIND);
  const len = new Int16Array(2 * KINDS);
  const wanted = t.pieces;
  // Target pieces per (side, kind) slot.
  const wantedLen = new Int16Array(2 * KINDS);
  for (let slot = 0; slot < 2 * KINDS; slot++) {
    wantedLen[slot] = wanted[slot >= KINDS ? 1 : 0]![slot % KINDS]!.length;
  }
  // Version of each slot's piece list: a fresh number whenever the list changes, and the old
  // one back when pop restores it. Equal versions mean equal lists, in the same order.
  const version = new Int32Array(2 * KINDS);
  let nextVersion = 1;
  // Pawn cost cache per side: the version it was computed for, plus a map of earlier pawn sets.
  const lastPawnVersion = new Int32Array(2);
  const lastPawnCost = new Float64Array(2);
  const pawnCache = [new Map<number | string, number>(), new Map<number | string, number>()];
  const pieceCount = new Int16Array(2);
  // Castlings still available per side: bit 0 kingside, bit 1 queenside (right + king and rook home).
  const castles = new Int8Array(2);
  // Per (side, kind) memo of the last inputs (list version, castlings and promotions) and cost.
  const memoVersion = new Int32Array(2 * KINDS);
  const memoKey = new Int32Array(2 * KINDS);
  const memoCost = new Float64Array(2 * KINDS);

  const pawnCostCached = (side: Side): number => {
    const slot = side * KINDS + K_PAWN;
    if (lastPawnVersion[side] === version[slot]) return lastPawnCost[side]!;
    const base = slot * MAX_PER_KIND;
    const n = len[slot]!;
    // Up to 8 pawns, 6 bits each (square 0..63), fit exactly in a number; more needs a string.
    let key: number | string;
    if (n <= 8) {
      let packed = 0;
      for (let i = 0; i < n; i++) {
        const sq = squares[base + i]!;
        packed = packed * 64 + ((sq >> 4) * 8 + (sq & 7)) + 1;
      }
      key = packed;
    } else {
      key = Array.from(squares.subarray(base, base + n)).join(',');
    }
    let cost = pawnCache[side]!.get(key);
    if (cost === undefined) {
      cost = pawnCost(side, squares, base, n, wanted[side]![K_PAWN]!);
      if (pawnCache[side]!.size > 100_000) pawnCache[side]!.clear();
      pawnCache[side]!.set(key, cost);
    }
    lastPawnVersion[side] = version[slot]!;
    lastPawnCost[side] = cost;
    return cost;
  };

  const sideBound = (side: Side): number => {
    if (pieceCount[side]! < t.counts[side]) return Infinity; // pieces never come back
    const first = side * KINDS;
    const spare = len[first + K_PAWN]! - wantedLen[first + K_PAWN]!;
    if (spare < 0) return Infinity;
    let unmatched = 0;
    for (let kind = 1; kind < KINDS; kind++) {
      const extra = wantedLen[first + kind]! - len[first + kind]!;
      if (extra > 0) unmatched += extra;
    }
    if (unmatched > spare) return Infinity; // not enough pawns left to promote

    let cost = wantedLen[first + K_PAWN] === 0 ? 0 : pawnCostCached(side);
    if (cost === Infinity) return Infinity;
    for (let kind = 1; kind < KINDS; kind++) {
      if (wantedLen[first + kind] === 0) continue;
      const c = memoKindCost(side, kind, kind === K_KING ? 0 : spare);
      if (c === Infinity) return Infinity;
      cost += c;
    }
    const other = side === WHITE ? BLACK : WHITE;
    const captures = pieceCount[other]! - t.counts[other];
    return captures > cost ? captures : cost;
  };

  /** kindCost, reused when this (side, kind) has exactly the same inputs as last time. */
  const memoKindCost = (side: Side, kind: number, promotions: number): number => {
    const slot = side * KINDS + kind;
    const key = (kind === K_KING || kind === K_ROOK ? castles[side]! : 0) * 256 + promotions;
    if (memoVersion[slot] === version[slot] && memoKey[slot] === key) return memoCost[slot]!;
    const cost = kindCost(side, kind, promotions);
    memoVersion[slot] = version[slot]!;
    memoKey[slot] = key;
    memoCost[slot] = cost;
    return cost;
  };

  /** Cheapest way to provide this kind's target pieces (see createBoundFn). */
  const kindCost = (side: Side, kind: number, promotions: number): number => {
    const targets = wanted[side]![kind]!;
    const n = targets.length;
    if (promotions >= n) return 0;
    const base = (side * KINDS + kind) * MAX_PER_KIND;
    const m = len[side * KINDS + kind]!;
    if (n === 1) {
      const to = targets[0]!;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const di = pieceDistance(t, castles[side]!, side, kind, squares[base + i]!, to);
        if (di < best) best = di;
      }
      return best;
    }
    if (n === 2) {
      const t0 = targets[0]!;
      const t1 = targets[1]!;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const di0 = pieceDistance(t, castles[side]!, side, kind, squares[base + i]!, t0);
        const di1 = pieceDistance(t, castles[side]!, side, kind, squares[base + i]!, t1);
        if (promotions === 1) {
          // One target matched, the other promoted.
          best = Math.min(best, di0, di1);
          continue;
        }
        for (let j = 0; j < m; j++) {
          if (j === i) continue;
          const dj0 = pieceDistance(t, castles[side]!, side, kind, squares[base + j]!, t0);
          const dj1 = pieceDistance(t, castles[side]!, side, kind, squares[base + j]!, t1);
          best = Math.min(best, di0 + dj1, di1 + dj0);
        }
      }
      return best;
    }
    return generalAssignment(m, n, promotions, (i, j) =>
      pieceDistance(t, castles[side]!, side, kind, squares[base + i]!, targets[j]!),
    );
  };

  // Undo log: entries of 5 ints (type, slot, index, square, the slot's previous version), and
  // the entry count before each push.
  let ops = new Int32Array(64 * OPS_PER_MOVE * 5);
  let opCount = 0;
  let marks = new Int32Array(64);
  let depth = 0;

  const log = (type: number, slot: number, index: number, sq: number, previous: number): void => {
    const o = opCount * 5;
    ops[o] = type;
    ops[o + 1] = slot;
    ops[o + 2] = index;
    ops[o + 3] = sq;
    ops[o + 4] = previous;
    opCount++;
  };
  const add = (slot: number, sq: number): void => {
    const n = len[slot]!;
    squares[slot * MAX_PER_KIND + n] = sq;
    len[slot] = n + 1;
    log(OP_ADD, slot, n, sq, version[slot]!);
    version[slot] = nextVersion++;
  };
  const remove = (slot: number, sq: number): void => {
    const base = slot * MAX_PER_KIND;
    const last = len[slot]! - 1;
    let i = last;
    while (i > 0 && squares[base + i] !== sq) i--;
    squares[base + i] = squares[base + last]!;
    len[slot] = last;
    log(OP_REMOVE, slot, i, sq, version[slot]!);
    version[slot] = nextVersion++;
  };

  const push = (p: Position, m: Move): void => {
    if (depth === marks.length) {
      const bigger = new Int32Array(marks.length * 2);
      bigger.set(marks);
      marks = bigger;
    }
    if ((opCount + OPS_PER_MOVE) * 5 > ops.length) {
      const bigger = new Int32Array(ops.length * 2);
      bigger.set(ops);
      ops = bigger;
    }
    marks[depth++] = opCount;
    const from = m & 0x7f;
    const to = (m >>> 7) & 0x7f;
    const placed = p.board[to]!;
    const side = placed > 0 ? WHITE : BLACK;
    const captured = p.undo[(p.ply - 1) * UNDO_STRIDE + 1]!;
    if (captured !== 0) {
      const other = side === WHITE ? BLACK : WHITE;
      const at = (m & FLAG_EN_PASSANT) !== 0 ? (to & 7) | (from & 0x70) : to;
      remove(other * KINDS + kindOf(captured, at), at);
      pieceCount[other]!--;
      log(OP_CAPTURE, other, 0, 0, 0);
    }
    const moved = (m & FLAG_PROMOTION) !== 0 ? (side === WHITE ? PAWN : -PAWN) : placed;
    remove(side * KINDS + kindOf(moved, from), from);
    add(side * KINDS + kindOf(placed, to), to);
    if ((m & FLAG_CASTLE) !== 0) {
      const rank = to & 0x70;
      const kingside = (to & 7) === 6;
      const slot = side * KINDS + K_ROOK;
      remove(slot, kingside ? rank + 7 : rank);
      add(slot, kingside ? rank + 5 : rank + 3);
    }
  };

  const pop = (): void => {
    const mark = marks[--depth]!;
    while (opCount > mark) {
      const o = --opCount * 5;
      const type = ops[o]!;
      const slot = ops[o + 1]!;
      if (type === OP_ADD) {
        len[slot]!--;
        version[slot] = ops[o + 4]!;
      } else if (type === OP_REMOVE) {
        const base = slot * MAX_PER_KIND;
        const i = ops[o + 2]!;
        const n = len[slot]!;
        squares[base + n] = squares[base + i]!;
        squares[base + i] = ops[o + 3]!;
        len[slot] = n + 1;
        version[slot] = ops[o + 4]!;
      } else {
        pieceCount[slot]!++; // OP_CAPTURE: `slot` holds the side
      }
    }
  };

  const castlesOf = (p: Position, side: Side): number => {
    if (p.castling === 0) return 0;
    const sign = side === WHITE ? 1 : -1;
    const options = CASTLES[side]!;
    let bits = 0;
    for (let i = 0; i < options.length; i++) {
      const c = options[i]!;
      if (
        (p.castling & c.right) !== 0 &&
        p.board[c.kingHome] === sign * KING &&
        p.board[c.rookHome] === sign * ROOK
      ) {
        bits |= 1 << i;
      }
    }
    return bits;
  };

  const evaluate = (p: Position, out: Int32Array): boolean => {
    castles[WHITE] = castlesOf(p, WHITE);
    castles[BLACK] = castlesOf(p, BLACK);
    const white = sideBound(WHITE);
    if (white === Infinity) return false;
    const black = sideBound(BLACK);
    if (black === Infinity) return false;
    out[0] = white;
    out[1] = black;
    return true;
  };

  const reset = (p: Position): void => {
    len.fill(0);
    pieceCount[0] = 0;
    pieceCount[1] = 0;
    opCount = 0;
    depth = 0;
    for (let slot = 0; slot < 2 * KINDS; slot++) version[slot] = nextVersion++;
    const b = p.board;
    for (let sq = 0; sq < 120; sq++) {
      if ((sq & 0x88) !== 0) {
        sq += 7;
        continue;
      }
      const piece = b[sq]!;
      if (piece === 0) continue;
      const side = piece > 0 ? WHITE : BLACK;
      const slot = side * KINDS + kindOf(piece, sq);
      const n = len[slot]!;
      if (n < MAX_PER_KIND) {
        squares[slot * MAX_PER_KIND + n] = sq;
        len[slot] = n + 1;
      }
      pieceCount[side]!++;
    }
  };

  return { reset, push, pop, evaluate };
}

/** Convenience wrapper returning an object (tests, analysis); the search uses createBoundFn. */
export function createLowerBound(t: Target): (p: Position) => Bound | null {
  const fn = createBoundFn(t);
  const out = new Int32Array(2);
  return (p) => (fn(p, out) ? { white: out[0]!, black: out[1]! } : null);
}

/**
 * Distance with the castling shortcuts for a king on its home square or a rook in its corner.
 * `castles`: bit i set when castling CASTLES[side][i] is still available (right, king and rook home).
 */
function pieceDistance(
  t: Target,
  castles: number,
  side: Side,
  kind: number,
  from: number,
  to: number,
): number {
  let d = obstacleDistance(t, kind, side, from, to);
  if ((kind !== K_KING && kind !== K_ROOK) || castles === 0) return d;
  const options = CASTLES[side]!;
  for (let i = 0; i < options.length; i++) {
    if (((castles >> i) & 1) === 0) continue;
    const c = options[i]!;
    if (kind === K_KING && from === c.kingHome)
      d = Math.min(d, 1 + obstacleDistance(t, kind, side, c.kingTo, to));
    if (kind === K_ROOK && from === c.rookHome)
      d = Math.min(d, obstacleDistance(t, kind, side, c.rookTo, to));
  }
  return d;
}

/**
 * The general case (3+ target pieces of one kind, which needs promotions): each target gets a
 * distinct current piece or, at most `promotions` times, a promoted pawn at cost 0.
 */
function generalAssignment(
  m: number,
  n: number,
  promotions: number,
  d: (i: number, j: number) => number,
): number {
  const memo = new Map<number, number>();
  const solve = (j: number, used: number, promoted: number): number => {
    if (j === n) return 0;
    const key = (j * 65536 + used) * 64 + promoted;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = promoted < promotions ? solve(j + 1, used, promoted + 1) : Infinity;
    for (let i = 0; i < m && i < 16 && best > 0; i++) {
      if ((used >> i) & 1) continue;
      const di = d(i, j);
      if (di !== Infinity) best = Math.min(best, di + solve(j + 1, used | (1 << i), promoted));
    }
    memo.set(key, best);
    return best;
  };
  return solve(0, 0, 0);
}

/**
 * Min-cost matching of target pawns to distinct current pawns (every target pawn needs one;
 * extra current pawns are free).
 *
 * A pawn already on a target pawn square is matched to it first: that is always part of some
 * cheapest matching. (Exchange argument: if pawn A on target square tA went to tX instead, and
 * pawn B to tA, swapping to A-tA, B-tX never costs more, because B can reach tX through tA:
 * cost(B, tX) <= cost(B, tA) + cost(tA, tX), and cost(tA, tX) is what A paid.) The remaining
 * pawns, usually few in a short proof game, go through an exact dynamic program over bitmasks
 * of matched targets.
 */
function pawnCost(
  side: Side,
  squares: Int16Array,
  base: number,
  n: number,
  wanted: readonly number[],
): number {
  const free: number[] = [];
  const open: number[] = [];
  const onTarget = new Uint8Array(128);
  for (const sq of wanted) onTarget[sq] = 1;
  for (let i = 0; i < n; i++) {
    const sq = squares[base + i]!;
    if (onTarget[sq] === 1)
      onTarget[sq] = 2; // matched in place
    else free.push(sq);
  }
  for (const sq of wanted) if (onTarget[sq] === 1) open.push(sq);
  const k = open.length;
  if (k === 0) return 0;
  if (k > free.length || k > 16) return Infinity;

  const full = (1 << k) - 1;
  let best = new Float64Array(full + 1).fill(Infinity);
  best[0] = 0;
  for (const from of free) {
    const next = best.slice(); // this pawn may stay unmatched
    for (let mask = 0; mask < full; mask++) {
      const cost = best[mask]!;
      if (cost === Infinity) continue;
      for (let j = 0; j < k; j++) {
        if ((mask >> j) & 1) continue;
        const d = pawnDistance(side, from, open[j]!);
        if (d === Infinity) continue;
        const nm = mask | (1 << j);
        if (cost + d < next[nm]!) next[nm] = cost + d;
      }
    }
    best = next;
  }
  return best[full]!;
}
