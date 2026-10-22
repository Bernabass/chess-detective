import {
  clonePosition,
  createRng,
  initialPosition,
  legalMoves,
  targetKey,
  uciToMove,
  type Position,
} from '@retrograde/engine';
import {
  moveInterest,
  record,
  type Candidate,
  type PlyStats,
  type Verified,
  type Verifier,
} from './candidates';
import { playAndDescribe, type MoveInfo } from './moves';
import { hasTransposedLastMove } from './verify';

export interface BeamOptions {
  seed: number;
  /** Frontier size per ply count (W). */
  width: number;
  /** Most children of one parent sent to full verification (the most interesting ones). */
  children: number;
  maxPlies: number;
  verifier: Verifier;
  /** First candidate index to use. */
  firstIndex?: number;
  /** Called after each ply count with that level's statistics. */
  onLevel?: (stats: PlyStats) => void;
}

/** An accepted puzzle and what the beam needs to extend it. */
export interface BeamNode {
  verified: Verified;
  infos: MoveInfo[];
  /** Index of the parent's candidate (-1 for one-ply games). */
  parent: number;
  score: number;
}

/**
 * Most children of one parent kept in the frontier, when there are enough parents to fill it
 * (with few parents, as near the start, each may keep width / parents).
 */
const MAX_CHILDREN = 3;
/**
 * Prefix caps for the frontier, as [plies, most puzzles sharing that many first plies]: a share
 * of the width for the first moves, so the pool doesn't grow from a handful of openings, and 2
 * per 6-ply prefix, because the pool allows only 3 puzzles per 6-ply prefix (pool.ts) and the
 * long lines must stay spread over many of them.
 */
function prefixCaps(width: number): [number, number][] {
  return [
    [1, Math.max(1, Math.floor(width / 6))],
    [2, Math.max(1, Math.floor(width / 12))],
    [4, Math.max(1, Math.floor(width / 15))],
    [6, 2],
  ];
}

/**
 * Grows unique shortest proof games one ply at a time (SPEC §7.2, decided 2026-10-22). Every
 * candidate is an accepted puzzle plus one legal move. Per parent, extensions that are plainly
 * not unique (the last move transposes to an earlier turn) are dropped for free, and only the
 * `children` most interesting of the rest (interest plus a seeded jitter) are verified (more while
 * the frontier is small, so about width * children candidates are verified per ply); all
 * verified candidates get the full solver checks, and the accepted ones of each length form the
 * next frontier (see selectFrontier). Lines where the mover's last three moves are quiet king
 * moves are skipped. Returns every accepted puzzle, by length.
 */
export async function runBeam(opts: BeamOptions): Promise<BeamNode[]> {
  const accepted: BeamNode[] = [];
  let index = opts.firstIndex ?? 0;
  let frontier: BeamNode[] = [
    {
      verified: {
        candidate: { index: -1, moves: [], target: targetKey(initialPosition()), source: 'beam' },
        verification: { status: 'accepted', nodes: 0, solverNodes: 0 },
        elapsedMs: 0,
      },
      infos: [],
      parent: -1,
      score: 0,
    },
  ];

  for (let plies = 1; plies <= opts.maxPlies && frontier.length > 0; plies++) {
    const candidates: Candidate[] = [];
    const meta: { parent: BeamNode; info: MoveInfo; switchback: boolean }[] = [];
    const perParent = Math.max(
      opts.children,
      Math.ceil((opts.width * opts.children) / frontier.length),
    );
    for (const parent of frontier) {
      const p = replayMoves(parent.verified.candidate.moves);
      const options: {
        moves: string[];
        target: string;
        info: MoveInfo;
        switchback: boolean;
        rank: number;
      }[] = [];
      for (const m of legalMoves(p)) {
        const child = clonePosition(p);
        const info = playAndDescribe(child, m);
        if (plainKingWalk([...parent.infos, info])) continue;
        const moves = [...parent.verified.candidate.moves, info.uci];
        const target = targetKey(child);
        // Free rejection first, so the verification slots go to candidates that may be unique.
        if (hasTransposedLastMove(moves, target)) continue;
        const switchback = isSwitchback(parent.infos, info);
        const jitter = createRng(opts.seed ^ Math.imul(hashMoves(moves), 0x85ebca6b)).nextFloat();
        options.push({
          moves,
          target,
          info,
          switchback,
          rank: moveInterest(info, switchback) + 2 * jitter,
        });
      }
      options.sort((a, b) => b.rank - a.rank || (a.info.uci < b.info.uci ? -1 : 1));
      for (const o of options.slice(0, perParent)) {
        candidates.push({ index: index++, moves: o.moves, target: o.target, source: 'beam' });
        meta.push({ parent, info: o.info, switchback: o.switchback });
      }
    }

    const results = await opts.verifier(candidates);
    const level = new Map<number, PlyStats>();
    const next: BeamNode[] = [];
    results.forEach((v, i) => {
      record(level, v);
      if (v.verification.status !== 'accepted') return;
      const item = meta[i];
      if (item === undefined) return;
      const { parent, info, switchback } = item;
      const jitter = createRng(
        opts.seed ^ Math.imul(v.candidate.index + 1, 0x9e3779b1),
      ).nextFloat();
      next.push({
        verified: v,
        infos: [...parent.infos, info],
        parent: parent.verified.candidate.index,
        score: parent.score * 0.5 + moveInterest(info, switchback) + jitter,
      });
    });
    const stats = level.get(plies);
    if (stats) opts.onLevel?.(stats);
    accepted.push(...next);
    frontier = selectFrontier(next, opts.width);
  }
  return accepted;
}

/** A 32-bit FNV-1a hash of a move list (seeds per-candidate randomness independently of order). */
export function hashMoves(moves: readonly string[]): number {
  let h = 0x811c9dc5;
  for (const ch of moves.join(' ')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

/**
 * The best `width` nodes, with at most max(MAX_CHILDREN, width / parents) per parent and the
 * prefixCaps. A prefix cap only applies to puzzles longer than the prefix (a puzzle is its own
 * prefix otherwise).
 */
export function selectFrontier(nodes: readonly BeamNode[], width: number): BeamNode[] {
  const sorted = [...nodes].sort(
    (a, b) => b.score - a.score || a.verified.candidate.index - b.verified.candidate.index,
  );
  const parents = new Set(nodes.map((n) => n.parent)).size;
  const childCap = Math.max(MAX_CHILDREN, Math.ceil(width / Math.max(1, parents)));
  const caps = prefixCaps(width);
  const perParent = new Map<number, number>();
  const perPrefix = new Map<string, number>();
  const chosen: BeamNode[] = [];
  for (const node of sorted) {
    if (chosen.length >= width) break;
    const moves = node.verified.candidate.moves;
    if ((perParent.get(node.parent) ?? 0) >= childCap) continue;
    const keys = caps
      .filter(([plies]) => moves.length > plies)
      .map(([plies, cap]) => ({ key: `${String(plies)}:${moves.slice(0, plies).join(' ')}`, cap }));
    if (keys.some(({ key, cap }) => (perPrefix.get(key) ?? 0) >= cap)) continue;
    perParent.set(node.parent, (perParent.get(node.parent) ?? 0) + 1);
    for (const { key } of keys) perPrefix.set(key, (perPrefix.get(key) ?? 0) + 1);
    chosen.push(node);
  }
  return chosen;
}

export function replayMoves(ucis: readonly string[]): Position {
  const p = initialPosition();
  for (const uci of ucis) {
    const r = uciToMove(p, uci);
    if (!r.ok) throw new Error(`illegal move ${uci}: ${r.error}`);
    playAndDescribe(p, r.value);
  }
  return p;
}

/** Whether the side that just moved made its last three moves as quiet king moves. */
export function plainKingWalk(infos: readonly MoveInfo[]): boolean {
  const last = infos[infos.length - 1];
  if (last === undefined) return false;
  const mine = infos.filter((_, i) => (infos.length - 1 - i) % 2 === 0).slice(-3);
  return (
    mine.length === 3 &&
    mine.every((m) => (m.piece === 'K' || m.piece === 'k') && m.captured === null && !m.castling)
  );
}

/** Whether `info` moves a piece back to a square that piece left earlier (tracks pieces by square). */
export function isSwitchback(history: readonly MoveInfo[], info: MoveInfo): boolean {
  // Follow the moving piece backwards through the moves that brought it to `info.from`.
  let square = info.from;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.to !== square) continue;
    if (m.from === info.to) return true;
    square = m.from;
  }
  return false;
}
