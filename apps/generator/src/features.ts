import type { MoveInfo } from './moves';

/** Feature tags of a solution (SPEC §7.3), in this fixed order in the output. */
export const FEATURES = [
  'capture',
  'promotion',
  'underpromotion',
  'castling',
  'en-passant',
  'switchback',
  'tempo',
  'king-walk',
  'phoenix',
] as const;
export type Feature = (typeof FEATURES)[number];

/** How often each scored feature occurs in a solution (the difficulty formula uses the counts). */
export interface FeatureCounts {
  captures: number;
  promotions: number;
  underpromotions: number;
  castling: number;
  enPassant: number;
  /** Returns of a piece to a square it left, other than an immediate back-and-forth. */
  switchbacks: number;
  /** Immediate back-and-forth moves (A to B, then straight back to A): a pure tempo loss. */
  tempo: number;
  /** The most king moves (castling not counted) made by one side. */
  kingMoves: number;
  /** Promotions to a piece type the same side had captured (an original piece, not a promoted one). */
  phoenix: number;
}

interface Tracked {
  /** Squares this piece has left, in order. */
  left: string[];
  /** Whether it came from a promotion. */
  promoted: boolean;
}

function rookCastlingSquares(info: MoveInfo): [string, string] {
  const rank = info.from.charAt(1);
  return info.to.startsWith('g') ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
}

/**
 * Counts the features of a solution by following every piece through the game (pieces are
 * tracked by identity, so a switchback is the same piece coming back, not just any piece).
 */
export function countFeatures(infos: readonly MoveInfo[]): FeatureCounts {
  const counts: FeatureCounts = {
    captures: 0,
    promotions: 0,
    underpromotions: 0,
    castling: 0,
    enPassant: 0,
    switchbacks: 0,
    tempo: 0,
    kingMoves: 0,
    phoenix: 0,
  };
  const pieces = new Map<string, Tracked>();
  const at = (square: string): Tracked => {
    const existing = pieces.get(square);
    if (existing) return existing;
    const fresh: Tracked = { left: [], promoted: false };
    pieces.set(square, fresh);
    return fresh;
  };
  /** Original (never promoted) pieces captured, by FEN letter. */
  const capturedOriginals = new Set<string>();
  const promotedTo: string[] = [];
  const kingMoves = [0, 0];

  const move = (from: string, to: string): Tracked => {
    const piece = at(from);
    pieces.delete(from);
    const last = piece.left[piece.left.length - 1];
    if (last === to) counts.tempo++;
    else if (piece.left.includes(to)) counts.switchbacks++;
    piece.left.push(from);
    pieces.set(to, piece);
    return piece;
  };

  for (const info of infos) {
    if (info.captured !== null) {
      counts.captures++;
      const victimSquare = info.enPassant ? `${info.to.charAt(0)}${info.from.charAt(1)}` : info.to;
      if (!at(victimSquare).promoted) capturedOriginals.add(info.captured);
      pieces.delete(victimSquare);
    }
    if (info.enPassant) counts.enPassant++;
    if (info.castling) {
      counts.castling++;
      const [rookFrom, rookTo] = rookCastlingSquares(info);
      move(info.from, info.to);
      move(rookFrom, rookTo);
      continue;
    }
    if (info.piece === 'K') kingMoves[0] = (kingMoves[0] ?? 0) + 1;
    if (info.piece === 'k') kingMoves[1] = (kingMoves[1] ?? 0) + 1;
    const piece = move(info.from, info.to);
    if (info.promotion !== null) {
      counts.promotions++;
      if (info.promotion.toLowerCase() !== 'q') counts.underpromotions++;
      // The promoted piece is a new piece: its history starts on the promotion square.
      pieces.set(info.to, { left: [], promoted: true });
      piece.left.length = 0;
      promotedTo.push(info.promotion);
    }
  }
  counts.kingMoves = Math.max(...kingMoves);
  counts.phoenix = promotedTo.filter((letter) => capturedOriginals.has(letter)).length;
  return counts;
}

/** The feature tags present in a solution, in FEATURES order. */
export function featureTags(c: FeatureCounts): Feature[] {
  const present: Record<Feature, boolean> = {
    capture: c.captures > 0,
    promotion: c.promotions > 0,
    underpromotion: c.underpromotions > 0,
    castling: c.castling > 0,
    'en-passant': c.enPassant > 0,
    switchback: c.switchbacks > 0,
    tempo: c.tempo > 0,
    'king-walk': c.kingMoves >= 2,
    phoenix: c.phoenix > 0,
  };
  return FEATURES.filter((f) => present[f]);
}
