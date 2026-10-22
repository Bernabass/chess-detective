import { BLACK, WHITE, squareName } from '../core/board';
import { targetKey, toFen } from '../core/fen';
import type { Position } from '../core/position';
import { replay } from '../core/replay';
import { shortestProofGame } from '../solver/shortest';
import { capturedList } from './describe';
import { COLOR_NAME, type Finding } from './findings';
import { isInitialPlacement, lastMoves, type LastMove, type LastMovesResult } from './lastmoves';
import { staticFindings } from './rules';

export type Verdict =
  /** At least one `illegal` finding. */
  | { kind: 'illegal'; findings: Finding[] }
  /** Proved by a proof game (UCI moves from the initial position). */
  | { kind: 'legal'; proof: string[]; findings: Finding[] }
  | { kind: 'undecided'; findings: Finding[]; reason: 'no-contradiction-found' | 'search-limit' };

export interface AnalyzeOptions {
  /** Last-move depth (default 3). */
  depth?: number;
  /** Default 2,000 ms. */
  timeLimitMs?: number;
  /** Default 200,000 retraction generations. */
  nodeLimit?: number;
  shouldStop?: () => boolean;
  /** Longest proof game the quick proof attempt looks for (default 10 plies; 0 disables it). */
  proofMaxPlies?: number;
  /** Time for the quick proof attempt (default 750 ms, separate from timeLimitMs). */
  proofTimeLimitMs?: number;
  /** Search nodes for the quick proof attempt (default 1,000,000). */
  proofNodeLimit?: number;
}

export interface AnalysisReport {
  verdict: Verdict;
  lastMoves: LastMovesResult;
}

/**
 * Full Lab analysis (SPEC §5): static rules, last moves at the requested depth, and the
 * last-move rules NO_POSSIBLE_LAST_MOVE, NO_POSSIBLE_HISTORY and LAST_MOVE_FORCED. `illegal`
 * only from certain contradictions. Otherwise a quick proof attempt (SPEC §5.1): `legal` only
 * with a proof game that reaches the position and keeps its stated castling rights and en
 * passant square; else `undecided`.
 */
export function analyzePosition(p: Position, opts: AnalyzeOptions = {}): AnalysisReport {
  const depth = Math.max(1, Math.floor(opts.depth ?? 3));
  const report = lastMoves(p, {
    depth,
    timeLimitMs: opts.timeLimitMs ?? 2000,
    nodeLimit: opts.nodeLimit ?? 200_000,
    ...(opts.shouldStop ? { shouldStop: opts.shouldStop } : {}),
  });
  const findings = [...staticFindings(p), ...lastMoveFindings(p, report)];
  const contradiction = findings.some((f) => f.severity === 'illegal');

  let verdict: Verdict;
  if (contradiction) {
    verdict = { kind: 'illegal', findings: sortFindings(findings) };
    return { verdict, lastMoves: report };
  }

  const attempt = proveQuickly(p, opts);
  if (attempt.proof !== null) {
    verdict = { kind: 'legal', proof: attempt.proof, findings: sortFindings(findings) };
  } else {
    const cutShort = report.status !== 'complete' || attempt.cutShort;
    verdict = {
      kind: 'undecided',
      findings: sortFindings(findings),
      reason: cutShort ? 'search-limit' : 'no-contradiction-found',
    };
  }
  return { verdict, lastMoves: report };
}

/**
 * The quick proof attempt: the shortest proof game up to `proofMaxPlies` that reaches the
 * position's placement and side to move, keeps every castling right it states and ends on the
 * en passant square it states. A found proof is replayed as a self-check.
 */
function proveQuickly(
  p: Position,
  opts: AnalyzeOptions,
): { proof: string[] | null; cutShort: boolean } {
  const maxPlies = Math.floor(opts.proofMaxPlies ?? 10);
  if (maxPlies <= 0) return { proof: null, cutShort: false };
  const castling = toFen(p).split(' ')[2] ?? '-';
  const r = shortestProofGame(targetKey(p), maxPlies, {
    timeLimitMs: opts.proofTimeLimitMs ?? 750,
    nodeLimit: opts.proofNodeLimit ?? 1_000_000,
    ...(castling === '-' ? {} : { castling }),
    ...(p.epSquare < 0 ? {} : { enPassant: squareName(p.epSquare) }),
    ...(opts.shouldStop ? { shouldStop: opts.shouldStop } : {}),
  });
  if (r.solution === null) return { proof: null, cutShort: r.status !== 'complete' };
  const check = replay(r.solution);
  const valid =
    check.ok &&
    targetKey(check.value) === targetKey(p) &&
    (check.value.castling & p.castling) === p.castling &&
    (p.epSquare < 0 || check.value.epSquare === p.epSquare);
  if (!valid)
    throw new Error(`internal error: proof ${r.solution.join(' ')} does not reach the position`);
  return { proof: r.solution, cutShort: false };
}

function sortFindings(findings: Finding[]): Finding[] {
  return [
    ...findings.filter((f) => f.severity === 'illegal'),
    ...findings.filter((f) => f.severity === 'deduction'),
  ];
}

function lastMoveFindings(p: Position, report: LastMovesResult): Finding[] {
  if (isInitialPlacement(p)) return [];
  const mover = COLOR_NAME[p.turn === WHITE ? BLACK : WHITE];
  const moves = report.moves;

  if (!moves.some((m) => m.possible)) {
    return [
      {
        rule: 'NO_POSSIBLE_LAST_MOVE',
        severity: 'illegal',
        message: `There's no move ${mover} could have just played to reach this position.`,
        squares: [],
      },
    ];
  }
  if (report.depth > 1 && moves.every((m) => m.viability === 'not-viable')) {
    return [
      {
        rule: 'NO_POSSIBLE_HISTORY',
        severity: 'illegal',
        message: `Every move ${mover} could have just played leads back to a position with no possible last move (checked ${String(report.depth)} moves deep).`,
        squares: [],
      },
    ];
  }

  // LAST_MOVE_FORCED: one distinct move survives, and everything else definitely doesn't.
  const viable = moves.filter((m) => m.viability === 'viable');
  const distinct = new Set(viable.map((m) => m.move));
  const allDecided = moves.every((m) => m.viability !== 'unknown');
  if (distinct.size !== 1 || !allDecided) return [];
  return [forcedFinding(p, viable, mover)];
}

function forcedFinding(p: Position, variants: readonly LastMove[], mover: string): Finding {
  // En passant is one kind of capture, never the plain move: when the same move could also be
  // an ordinary capture, the message must not claim it was en passant.
  const plain = variants.find((m) => m.uncaptured === null);
  const ordinary = variants.filter((m) => m.uncaptured !== null && m.kind !== 'un-en-passant');
  const enPassant = variants.find((m) => m.kind === 'un-en-passant');
  const victim = COLOR_NAME[p.turn].toLowerCase();
  const first = variants[0]!;
  let text: string;
  if (plain === undefined && ordinary.length === 0 && enPassant !== undefined) {
    text = enPassant.notation; // e.g. "e5xd6 e.p.": the only way
  } else {
    const ep = enPassant === undefined ? 'none' : ordinary.length > 0 || plain ? 'also' : 'only';
    const hasOrdinaryPawn = ordinary.some((m) => m.uncaptured?.toLowerCase() === 'p');
    const list = capturedList(
      ordinary.map((m) => m.uncaptured ?? ''),
      ep === 'also' && !hasOrdinaryPawn ? 'only' : ep,
    );
    if (plain && ordinary.length === 0 && enPassant === undefined) {
      text = plain.notation;
    } else if (plain) {
      text = `${plain.notation}, possibly capturing a ${victim} ${list}`;
    } else {
      const notation = (ordinary[0] ?? first).notation.replace(' e.p.', '');
      text = `${notation}, capturing a ${victim} ${list}`;
    }
  }
  const from = first.move.slice(0, 2);
  const to = first.move.slice(2, 4);
  return {
    rule: 'LAST_MOVE_FORCED',
    severity: 'deduction',
    message: `${mover}'s last move must have been ${text}.`,
    squares: [from, to],
    arrows: [[from, to]],
  };
}
