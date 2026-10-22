import { WHITE } from '../core/board';
import { initialPosition } from '../core/fen';
import { createLowerBound } from './bound';
import { defaultTtBits, solveFrom, type SolveOptions } from './search';
import { parseTarget } from './target';
import { TranspositionTable } from './tt';

export interface ShortestResult {
  status: 'complete' | 'limit' | 'aborted';
  /** Length of the proof found, in plies. */
  plies: number | null;
  /** complete + solution: a proven shortest proof game. complete + null: none up to maxPlies. */
  solution: string[] | null;
  nodes: number;
  elapsedMs: number;
  /** Ply counts searched completely without finding a solution. */
  searched: number[];
}

export type ShortestOptions = Omit<SolveOptions, 'plies' | 'mode' | 'cap'>;

/**
 * The shortest proof game for `target` up to `maxPlies` (SPEC §6.1). The target's side to move
 * fixes the parity of the length, and the lower bound from the initial position gives the
 * first length worth trying: N0 is the smallest length of that parity giving White at least
 * h_White moves and Black at least h_Black. Then N0, N0 + 2, ... share one time and node budget
 * and one transposition table.
 */
export function shortestProofGame(
  target: string,
  maxPlies: number,
  opts: ShortestOptions = {},
): ShortestResult {
  const startTime = Date.now();
  const parsed = parseTarget(target);
  if (!parsed.ok) throw new Error(parsed.error);
  const t = parsed.value;
  const result: ShortestResult = {
    status: 'complete',
    plies: null,
    solution: null,
    nodes: 0,
    elapsedMs: 0,
    searched: [],
  };
  const finish = (): ShortestResult => {
    result.elapsedMs = Date.now() - startTime;
    return result;
  };

  const h = createLowerBound(t)(initialPosition());
  if (h === null) return finish(); // unreachable from the start: no proof of any length

  // White moves first: after N plies White has made ceil(N/2) moves and Black floor(N/2).
  let n = t.turn === WHITE ? 0 : 1;
  while (Math.ceil(n / 2) < h.white || Math.floor(n / 2) < h.black) n += 2;

  // Created on first use: often nothing is searched at all (the lower bound alone exceeds
  // maxPlies), and analyzePosition calls this for every Lab analysis.
  let tt: TranspositionTable | null = null;
  for (; n <= maxPlies; n += 2) {
    const elapsed = Date.now() - startTime;
    const outOfTime = opts.timeLimitMs !== undefined && elapsed >= opts.timeLimitMs;
    const outOfNodes = opts.nodeLimit !== undefined && result.nodes >= opts.nodeLimit;
    if (outOfTime || outOfNodes) {
      result.status = 'limit';
      return finish();
    }
    tt ??= new TranspositionTable(opts.ttBits ?? defaultTtBits(maxPlies));
    const r = solveFrom(
      initialPosition(),
      t,
      {
        ...opts,
        plies: n,
        mode: 'find-one',
        ...(opts.timeLimitMs === undefined ? {} : { timeLimitMs: opts.timeLimitMs - elapsed }),
        ...(opts.nodeLimit === undefined ? {} : { nodeLimit: opts.nodeLimit - result.nodes }),
        ...(opts.onProgress === undefined
          ? {}
          : {
              onProgress: (prog: { nodes: number; elapsedMs: number }) => {
                opts.onProgress?.({
                  nodes: result.nodes + prog.nodes,
                  elapsedMs: elapsed + prog.elapsedMs,
                });
              },
            }),
      },
      tt,
    );
    result.nodes += r.nodes;
    if (r.status !== 'complete') {
      result.status = r.status;
      return finish();
    }
    const solution = r.solutions[0];
    if (solution !== undefined) {
      result.plies = n;
      result.solution = solution;
      return finish();
    }
    result.searched.push(n);
  }
  return finish();
}
