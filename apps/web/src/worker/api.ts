import {
  analyzePosition,
  lastMoves as engineLastMoves,
  minimumPlies,
  parseFen,
  shortestProofGame,
  targetKey,
  type LastMovesResult,
  type Position,
  type Verdict,
} from '@retrograde/engine';

/**
 * The engine calls the Lab makes, as plain functions on serializable data (SPEC §9.4). They run
 * in the engine worker (engine.worker.ts), never on the main thread; they're pure, so tests call
 * them directly.
 */

export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AnalysisDto {
  verdict: Verdict;
  lastMoves: LastMovesResult;
  elapsedMs: number;
}

export interface ProveProgress {
  /** The proof length being searched. */
  plies: number;
  nodes: number;
  elapsedMs: number;
}

export interface ProveDto {
  status: 'complete' | 'limit' | 'aborted';
  /** UCI moves of the shortest proof game, or null if there is none up to maxPlies. */
  solution: string[] | null;
  nodes: number;
  elapsedMs: number;
  /** Fewest plies any proof game can have (the solver's lower bound), or null if unreachable. */
  minimumPlies: number | null;
  maxPlies: number;
}

function position(fen: string): EngineResult<Position> {
  const r = parseFen(fen);
  return r.ok
    ? { ok: true, value: r.value }
    : { ok: false, error: r.error.map((e) => e.message).join(' ') };
}

export function analyze(fen: string, depth: number): EngineResult<AnalysisDto> {
  const p = position(fen);
  if (!p.ok) return p;
  const t0 = performance.now();
  const report = analyzePosition(p.value, { depth });
  return {
    ok: true,
    value: { ...report, elapsedMs: Math.round(performance.now() - t0) },
  };
}

export function lastMoves(fen: string, depth: number): EngineResult<LastMovesResult> {
  const p = position(fen);
  if (!p.ok) return p;
  return { ok: true, value: engineLastMoves(p.value, { depth, timeLimitMs: 2000 }) };
}

/**
 * Shortest proof game for the position, up to maxPlies, keeping the FEN's stated castling rights
 * and en passant square (the same claims rule as the analysis). No time limit: the Lab cancels by
 * terminating the worker.
 */
export function prove(
  fen: string,
  maxPlies: number,
  onProgress?: (p: ProveProgress) => void,
): EngineResult<ProveDto> {
  const parsed = position(fen);
  if (!parsed.ok) return parsed;
  const fields = fen.trim().split(/\s+/);
  const castling = fields[2] && fields[2] !== '-' ? fields[2] : '';
  const enPassant = fields[3] && fields[3] !== '-' ? fields[3] : undefined;
  const target = targetKey(parsed.value);
  const r = shortestProofGame(target, maxPlies, {
    castling,
    ...(enPassant === undefined ? {} : { enPassant }),
    ...(onProgress === undefined ? {} : { onProgress }),
  });
  return {
    ok: true,
    value: {
      status: r.status,
      solution: r.solution,
      nodes: r.nodes,
      elapsedMs: r.elapsedMs,
      minimumPlies: minimumPlies(target),
      maxPlies,
    },
  };
}

export const engineApi = { analyze, lastMoves, prove };
export type EngineApi = typeof engineApi;
