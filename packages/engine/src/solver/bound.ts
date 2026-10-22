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
  ROOK,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  type Side,
} from '../core/board';
import type { Position } from '../core/position';
import {
  K_KING,
  K_PAWN,
  K_ROOK,
  KINDS,
  distance,
  kindOf,
  kingDistance,
  pawnDistance,
  rookDistance,
  type Target,
} from './target';

/** Minimum moves each side still needs to reach the target (SPEC §6.3). */
export interface Bound {
  white: number;
  black: number;
}

/** Writes [white, black] into `out` and returns true, or returns false if the target is unreachable. */
export type BoundFn = (p: Position, out: Int32Array) => boolean;

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
 */
export function createBoundFn(t: Target): BoundFn {
  // Current pieces: squares[(side * KINDS + kind) * MAX_PER_KIND + i], counts in len.
  const squares = new Int16Array(2 * KINDS * MAX_PER_KIND);
  const len = new Int16Array(2 * KINDS);
  const wanted = t.pieces;
  const wantedLen = [0, 1].map((side) => wanted[side]!.map((list) => list.length));
  // Pawn cost cache per side: the last pawn set, plus a map of earlier ones.
  const lastPawns = [
    new Int16Array(MAX_PER_KIND + 1).fill(-1),
    new Int16Array(MAX_PER_KIND + 1).fill(-1),
  ];
  const lastPawnCost = [0, 0];
  const pawnCache = [new Map<number | string, number>(), new Map<number | string, number>()];
  const pieceCount = new Int16Array(2);

  const pawnCostCached = (side: Side): number => {
    const base = (side * KINDS + K_PAWN) * MAX_PER_KIND;
    const n = len[side * KINDS + K_PAWN]!;
    const last = lastPawns[side]!;
    let same = last[0] === n;
    for (let i = 0; same && i < n; i++) same = last[i + 1] === squares[base + i];
    if (same) return lastPawnCost[side]!;
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
    last[0] = n;
    for (let i = 0; i < n; i++) last[i + 1] = squares[base + i]!;
    lastPawnCost[side] = cost;
    return cost;
  };

  const sideBound = (p: Position, side: Side): number => {
    if (pieceCount[side]! < t.counts[side]) return Infinity; // pieces never come back
    const spare = len[side * KINDS + K_PAWN]! - wantedLen[side]![K_PAWN]!;
    if (spare < 0) return Infinity;
    let unmatched = 0;
    for (let kind = 1; kind < KINDS; kind++) {
      const extra = wantedLen[side]![kind]! - len[side * KINDS + kind]!;
      if (extra > 0) unmatched += extra;
    }
    if (unmatched > spare) return Infinity; // not enough pawns left to promote

    const pawnsWanted = wantedLen[side]![K_PAWN]!;
    let cost = pawnsWanted === 0 ? 0 : pawnCostCached(side);
    if (cost === Infinity) return Infinity;
    for (let kind = 1; kind < KINDS; kind++) {
      const piecesWanted = wantedLen[side]![kind]!;
      if (piecesWanted === 0) continue;
      const c = kindCost(p, side, kind, kind === K_KING ? 0 : spare);
      if (c === Infinity) return Infinity;
      cost += c;
    }
    const other = side === WHITE ? BLACK : WHITE;
    const captures = pieceCount[other]! - t.counts[other];
    return captures > cost ? captures : cost;
  };

  /** Cheapest way to provide this kind's target pieces (see createBoundFn). */
  const kindCost = (p: Position, side: Side, kind: number, promotions: number): number => {
    const targets = wanted[side]![kind]!;
    const n = targets.length;
    if (promotions >= n) return 0;
    const base = (side * KINDS + kind) * MAX_PER_KIND;
    const m = len[side * KINDS + kind]!;
    if (n === 1) {
      const to = targets[0]!;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const di = pieceDistance(p, side, kind, squares[base + i]!, to);
        if (di < best) best = di;
      }
      return best;
    }
    if (n === 2) {
      const t0 = targets[0]!;
      const t1 = targets[1]!;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const di0 = pieceDistance(p, side, kind, squares[base + i]!, t0);
        const di1 = pieceDistance(p, side, kind, squares[base + i]!, t1);
        if (promotions === 1) {
          // One target matched, the other promoted.
          best = Math.min(best, di0, di1);
          continue;
        }
        for (let j = 0; j < m; j++) {
          if (j === i) continue;
          const dj0 = pieceDistance(p, side, kind, squares[base + j]!, t0);
          const dj1 = pieceDistance(p, side, kind, squares[base + j]!, t1);
          best = Math.min(best, di0 + dj1, di1 + dj0);
        }
      }
      return best;
    }
    return generalAssignment(m, n, promotions, (i, j) =>
      pieceDistance(p, side, kind, squares[base + i]!, targets[j]!),
    );
  };

  return (p: Position, out: Int32Array): boolean => {
    len.fill(0);
    pieceCount[0] = 0;
    pieceCount[1] = 0;
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
    const white = sideBound(p, WHITE);
    if (white === Infinity) return false;
    const black = sideBound(p, BLACK);
    if (black === Infinity) return false;
    out[0] = white;
    out[1] = black;
    return true;
  };
}

/** Convenience wrapper returning an object (tests, analysis); the search uses createBoundFn. */
export function createLowerBound(t: Target): (p: Position) => Bound | null {
  const fn = createBoundFn(t);
  const out = new Int32Array(2);
  return (p) => (fn(p, out) ? { white: out[0]!, black: out[1]! } : null);
}

/** Distance with the castling shortcuts for a king on its home square or a rook in its corner. */
function pieceDistance(p: Position, side: Side, kind: number, from: number, to: number): number {
  let d = distance(kind, side, from, to);
  if ((kind !== K_KING && kind !== K_ROOK) || p.castling === 0) return d;
  const sign = side === WHITE ? 1 : -1;
  for (const c of CASTLES[side]!) {
    if ((p.castling & c.right) === 0) continue;
    if (p.board[c.kingHome] !== sign * KING || p.board[c.rookHome] !== sign * ROOK) continue;
    if (kind === K_KING && from === c.kingHome) d = Math.min(d, 1 + kingDistance(c.kingTo, to));
    if (kind === K_ROOK && from === c.rookHome) d = Math.min(d, rookDistance(c.rookTo, to));
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
