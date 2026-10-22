import {
  BISHOP,
  BLACK,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  fileOf,
  rankOf,
  type Side,
} from '../core/board';
import { parseFen } from '../core/fen';
import { err, ok, type Result } from '../util/result';

/**
 * Piece kinds for matching (SPEC §6.3). Bishops are split by square colour because a bishop
 * never changes colour.
 */
export const K_PAWN = 0;
export const K_KNIGHT = 1;
export const K_LIGHT_BISHOP = 2;
export const K_DARK_BISHOP = 3;
export const K_ROOK = 4;
export const K_QUEEN = 5;
export const K_KING = 6;
export const KINDS = 7;

export function isLight(sq: number): boolean {
  return (fileOf(sq) + rankOf(sq)) % 2 === 1;
}

/** Matching kind of a piece code standing on `sq`, or -1 for an empty square. */
export function kindOf(piece: number, sq: number): number {
  switch (Math.abs(piece)) {
    case PAWN:
      return K_PAWN;
    case KNIGHT:
      return K_KNIGHT;
    case BISHOP:
      return isLight(sq) ? K_LIGHT_BISHOP : K_DARK_BISHOP;
    case ROOK:
      return K_ROOK;
    case QUEEN:
      return K_QUEEN;
    case KING:
      return K_KING;
    default:
      return -1;
  }
}

/** A target: placement plus side to move (SPEC §2), with its pieces grouped for matching. */
export interface Target {
  key: string;
  board: Int8Array;
  turn: Side;
  /** pieces[side][kind]: squares of the target's pieces. */
  pieces: number[][][];
  /** Total pieces per side. */
  counts: [number, number];
  /**
   * Squares of the target's pawns on their starting rank. Such a pawn never moved (no pawn can
   * come back to its second rank), so it stands there all game and is never captured: no piece
   * of either side can ever stand on or pass through these squares.
   */
  frozen: Uint8Array;
  /** Distance tables on the frozen-pawn board by kind * 128 + to, built on first use (see obstacleDistance). */
  tables: (Uint8Array | undefined)[];
}

/** Parses a target key ("placement w|b"). Anything else, including a full FEN, is an error. */
export function parseTarget(key: string): Result<Target, string> {
  const fields = key.trim().split(/\s+/);
  if (fields.length !== 2) {
    return err(
      `A target is the FEN placement and side to move, like "<placement> w"; got "${key}".`,
    );
  }
  const parsed = parseFen(`${fields[0] ?? ''} ${fields[1] ?? ''} - - 0 1`);
  if (!parsed.ok) return err(parsed.error.map((e) => e.message).join(' '));
  const p = parsed.value;
  const pieces = [0, 1].map(() => Array.from({ length: KINDS }, () => [] as number[]));
  const counts: [number, number] = [0, 0];
  const frozen = new Uint8Array(128);
  for (let sq = 0; sq < 128; sq++) {
    const piece = p.board[sq]!;
    if ((sq & 0x88) !== 0 || piece === 0) continue;
    const side = piece > 0 ? WHITE : BLACK;
    pieces[side]![kindOf(piece, sq)]!.push(sq);
    counts[side]++;
    if ((piece === PAWN && rankOf(sq) === 1) || (piece === -PAWN && rankOf(sq) === 6))
      frozen[sq] = 1;
  }
  return ok({
    key: fields.join(' '),
    board: p.board,
    turn: p.turn,
    pieces,
    counts,
    frozen,
    tables: [],
  });
}

// ---- Empty-board distances (lower bounds on moves, SPEC §6.3) ----

const KNIGHT_TABLE = (() => {
  const table = new Uint8Array(128 * 128).fill(255);
  const steps = [33, 31, 18, 14, -14, -18, -31, -33];
  for (let from = 0; from < 128; from++) {
    if ((from & 0x88) !== 0) continue;
    const queue = [from];
    table[from * 128 + from] = 0;
    // Breadth-first: the array iterator also visits squares pushed during the loop.
    for (const sq of queue) {
      const d = table[from * 128 + sq]!;
      for (const step of steps) {
        const next = sq + step;
        if ((next & 0x88) !== 0 || table[from * 128 + next] !== 255) continue;
        table[from * 128 + next] = d + 1;
        queue.push(next);
      }
    }
  }
  return table;
})();

export function knightDistance(from: number, to: number): number {
  return KNIGHT_TABLE[from * 128 + to]!;
}

export function kingDistance(from: number, to: number): number {
  return Math.max(Math.abs(fileOf(from) - fileOf(to)), Math.abs(rankOf(from) - rankOf(to)));
}

function sameLine(from: number, to: number): boolean {
  return fileOf(from) === fileOf(to) || rankOf(from) === rankOf(to);
}

function sameDiagonal(from: number, to: number): boolean {
  return Math.abs(fileOf(from) - fileOf(to)) === Math.abs(rankOf(from) - rankOf(to));
}

export function bishopDistance(from: number, to: number): number {
  if (from === to) return 0;
  if (sameDiagonal(from, to)) return 1;
  return isLight(from) === isLight(to) ? 2 : Infinity;
}

export function rookDistance(from: number, to: number): number {
  if (from === to) return 0;
  return sameLine(from, to) ? 1 : 2;
}

export function queenDistance(from: number, to: number): number {
  if (from === to) return 0;
  return sameLine(from, to) || sameDiagonal(from, to) ? 1 : 2;
}

/**
 * Pawn moves from `from` to `to` for `side`: every move advances one rank, except a double
 * push from the start rank, which needs two straight ranks before any file change.
 */
export function pawnDistance(side: Side, from: number, to: number): number {
  const dr = side === WHITE ? rankOf(to) - rankOf(from) : rankOf(from) - rankOf(to);
  const df = Math.abs(fileOf(to) - fileOf(from));
  if (dr < 0 || df > dr) return Infinity;
  const startRank = side === WHITE ? 1 : 6;
  return rankOf(from) === startRank && dr - df >= 2 ? dr - 1 : dr;
}

/** Distance by matching kind (king and rook castling shortcuts are handled by the bound). */
export function distance(kind: number, side: Side, from: number, to: number): number {
  switch (kind) {
    case K_PAWN:
      return pawnDistance(side, from, to);
    case K_KNIGHT:
      return knightDistance(from, to);
    case K_LIGHT_BISHOP:
    case K_DARK_BISHOP:
      return bishopDistance(from, to);
    case K_ROOK:
      return rookDistance(from, to);
    case K_QUEEN:
      return queenDistance(from, to);
    default:
      return kingDistance(from, to);
  }
}

const KNIGHT_JUMPS = [33, 31, 18, 14, -14, -18, -31, -33] as const;
const KING_STEPS = [17, 16, 15, 1, -1, -15, -16, -17] as const;
const ROOK_RAYS = [16, -16, 1, -1] as const;
const BISHOP_RAYS = [17, 15, -15, -17] as const;
const UNREACHABLE = 255;

/**
 * Distances to `to` from every square for a piece of `kind`, by breadth-first search on a board
 * whose only obstacles are the target's frozen pawns. These are still lower bounds (the obstacles
 * are there all game), and much tighter than empty-board distances while most pawns are at
 * home: a bishop behind unmoved pawns can't get out at all. All these move sets are symmetric,
 * so a search outward from `to` gives the distance from any square to `to`.
 */
function distanceTable(t: Target, kind: number, to: number): Uint8Array {
  const key = kind * 128 + to;
  const cached = t.tables[key];
  if (cached !== undefined) return cached;
  const dist = new Uint8Array(128).fill(UNREACHABLE);
  if (t.frozen[to] !== 1) {
    dist[to] = 0;
    const queue = [to];
    const rays =
      kind === K_ROOK ? ROOK_RAYS : kind === K_QUEEN ? [...ROOK_RAYS, ...BISHOP_RAYS] : BISHOP_RAYS;
    const sliding =
      kind === K_ROOK || kind === K_QUEEN || kind === K_LIGHT_BISHOP || kind === K_DARK_BISHOP;
    for (const sq of queue) {
      const d = dist[sq]! + 1;
      const visit = (next: number): boolean => {
        if ((next & 0x88) !== 0 || t.frozen[next] === 1) return false;
        if (dist[next] === UNREACHABLE) {
          dist[next] = d;
          queue.push(next);
        }
        return true;
      };
      if (sliding) {
        for (const ray of rays) for (let next = sq + ray; visit(next); next += ray);
      } else {
        for (const step of kind === K_KNIGHT ? KNIGHT_JUMPS : KING_STEPS) visit(sq + step);
      }
    }
  }
  t.tables[key] = dist;
  return dist;
}

/** Lower bound on moves for a piece of `kind` from `from` to the target square `to` (SPEC §6.3). */
export function obstacleDistance(
  t: Target,
  kind: number,
  side: Side,
  from: number,
  to: number,
): number {
  if (kind === K_PAWN) return pawnDistance(side, from, to);
  const d = distanceTable(t, kind, to)[from]!;
  return d === UNREACHABLE ? Infinity : d;
}
