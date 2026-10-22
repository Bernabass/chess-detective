import { makeMove, unmakeMove } from './makemove';
import { MAX_MOVES, generateLegalMoves } from './movegen';
import type { Position } from './position';

/**
 * Counts the leaf nodes of the legal move tree to `depth` plies. Comparing the counts with
 * published values is the standard proof that move generation is correct. At depth 1 the
 * legal moves are counted without recursing ("bulk counting"). The position is left unchanged.
 */
export function perft(p: Position, depth: number): number {
  if (depth <= 0) return 1;
  // One move buffer per ply, allocated once: the recursion itself allocates nothing.
  const buffers = Array.from({ length: depth }, () => new Int32Array(MAX_MOVES));
  return count(p, depth, buffers);
}

function count(p: Position, depth: number, buffers: Int32Array[]): number {
  const moves = buffers[depth - 1]!;
  const n = generateLegalMoves(p, moves);
  if (depth === 1) return n;
  let total = 0;
  for (let i = 0; i < n; i++) {
    makeMove(p, moves[i]!);
    total += count(p, depth - 1, buffers);
    unmakeMove(p);
  }
  return total;
}
