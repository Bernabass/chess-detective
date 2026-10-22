import type { MoveInfo } from './moves';
import type { Verification } from './verify';

/** A game to verify: its target (placement + side to move) at exactly `moves.length` plies. */
export interface Candidate {
  /** Deterministic index: puzzle ids and output order come from it. */
  index: number;
  moves: string[];
  target: string;
  source: 'beam' | 'random';
}

export interface Verified {
  candidate: Candidate;
  verification: Verification;
  /** Wall time spent verifying (statistics only, never part of the output). */
  elapsedMs: number;
}

/** Verifies a batch; results in the same order. Runs inline or on worker threads. */
export type Verifier = (batch: readonly Candidate[]) => Promise<Verified[]>;

/** Per-ply counts for `stats` (acceptance rate and time per candidate by N, SPEC §7.2). */
export interface PlyStats {
  plies: number;
  candidates: number;
  accepted: number;
  notUnique: number;
  notShortest: number;
  limit: number;
  totalMs: number;
  maxMs: number;
}

export function emptyStats(plies: number): PlyStats {
  return {
    plies,
    candidates: 0,
    accepted: 0,
    notUnique: 0,
    notShortest: 0,
    limit: 0,
    totalMs: 0,
    maxMs: 0,
  };
}

export function record(stats: Map<number, PlyStats>, v: Verified): void {
  const plies = v.candidate.moves.length;
  const s = stats.get(plies) ?? emptyStats(plies);
  stats.set(plies, s);
  s.candidates++;
  s.totalMs += v.elapsedMs;
  s.maxMs = Math.max(s.maxMs, v.elapsedMs);
  if (v.verification.status === 'accepted') s.accepted++;
  else if (v.verification.status === 'not-unique') s.notUnique++;
  else if (v.verification.status === 'not-shortest') s.notShortest++;
  else s.limit++;
}

/** Last-move interest for the beam: captures, promotions, castling, en passant, checks, switchbacks. */
export function moveInterest(info: MoveInfo, switchback: boolean): number {
  let score = 0;
  if (info.captured !== null) score += 2;
  if (info.promotion !== null) score += info.promotion.toLowerCase() === 'q' ? 3 : 4;
  if (info.castling) score += 3;
  if (info.enPassant) score += 4;
  if (info.check) score += 1;
  if (switchback) score += 2;
  return score;
}
