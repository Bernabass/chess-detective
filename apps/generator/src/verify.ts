import {
  initialPosition,
  makeMove,
  minimumPlies,
  solveProofGame,
  targetKey,
  uciToMove,
} from '@retrograde/engine';

export interface Verification {
  /**
   * accepted: the unique shortest proof game. not-unique: another game of the same length
   * exists. not-shortest: a shorter game exists. limit: a search hit the node limit (discard).
   */
  status: 'accepted' | 'not-unique' | 'not-shortest' | 'limit';
  /** Total search nodes spent on the checks. */
  nodes: number;
  /**
   * Nodes of the uniqueness count at N: how hard the solver found it to see that there is exactly
   * one game (the difficulty score uses it). 0 when rejected without a search.
   */
  solverNodes: number;
}

/**
 * Full verification of a candidate target at `plies` (SPEC §7.2): exactly one game of that length
 * (count with cap 2), and no game of length plies - 2, plies - 4, ... down to minimumPlies.
 * When the game itself is given, a transposition of its last move is tried first (free).
 * Uniqueness runs first: it fails most often and stops at the second solution, so a
 * shortest-but-not-unique candidate never pays for the exhaustive shortest checks.
 * Every search is bounded by `nodeLimit` (never time), so the verdict is the same on any machine.
 */
export function verifyCandidate(
  target: string,
  plies: number,
  nodeLimit: number,
  moves?: readonly string[],
): Verification {
  if (moves !== undefined && hasTransposedLastMove(moves, target)) {
    return { status: 'not-unique', nodes: 0, solverNodes: 0 };
  }
  let nodes = 0;
  const unique = solveProofGame(target, { plies, mode: 'count', cap: 2, nodeLimit });
  nodes += unique.nodes;
  const solverNodes = unique.nodes;
  if (unique.status !== 'complete') return { status: 'limit', nodes, solverNodes };
  if (unique.count !== 1) return { status: 'not-unique', nodes, solverNodes };

  const shortest = minimumPlies(target) ?? plies;
  for (let n = plies - 2; n >= shortest; n -= 2) {
    const r = solveProofGame(target, { plies: n, mode: 'count', cap: 1, nodeLimit });
    nodes += r.nodes;
    if (r.status !== 'complete') return { status: 'limit', nodes, solverNodes };
    if (r.count > 0) return { status: 'not-shortest', nodes, solverNodes };
  }
  return { status: 'accepted', nodes, solverNodes };
}

/** The final target key of a UCI game from the start, or null if a move is illegal. */
function replayTarget(ucis: readonly string[]): string | null {
  const p = initialPosition();
  for (const uci of ucis) {
    const r = uciToMove(p, uci);
    if (!r.ok) return null;
    makeMove(p, r.value);
  }
  return targetKey(p);
}

/**
 * A cheap, sound test for non-uniqueness: if the last move can be played at one of the same
 * side's earlier turns instead (that side's later moves each shifted one turn on, the opponent's
 * moves unchanged) and the game stays legal and reaches the same target, that is a second
 * solution. Most extensions that fail uniqueness fail this way, in microseconds instead of a
 * search.
 */
export function hasTransposedLastMove(moves: readonly string[], target: string): boolean {
  const n = moves.length;
  const last = moves[n - 1];
  if (last === undefined) return false;
  for (let j = n - 3; j >= 0; j -= 2) {
    const reordered = [...moves];
    reordered[j] = last;
    for (let k = j + 2; k < n; k += 2) reordered[k] = moves[k - 2] ?? '';
    if (reordered.every((m, i) => m === moves[i])) continue;
    if (replayTarget(reordered) === target) return true;
  }
  return false;
}
