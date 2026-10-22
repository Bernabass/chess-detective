import { BISHOP_STEPS, KING_STEPS, KNIGHT_STEPS, ROOK_STEPS, isAttacked } from '../core/attacks';
import {
  A1,
  A8,
  B1,
  B8,
  BISHOP,
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
  KNIGHT,
  NO_SQUARE,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  pieceLetter,
  rankOf,
  type Side,
} from '../core/board';
import { makeMove, unmakeMove } from '../core/makemove';
import { MAX_MOVES, findPseudoMove } from '../core/movegen';
import { Position } from '../core/position';
import { moveToUci } from '../core/uci';
import { computeHash } from '../core/zobrist';
import { isLightSquare, material, minPromotions, type Material } from './rules';

export type RetractionKind =
  'normal' | 'uncapture' | 'unpromotion' | 'unpromotion-uncapture' | 'un-en-passant' | 'uncastle';

/** One way the position could have arisen: `move` (UCI), played in `prior`, gives it. */
export interface Retraction {
  /** The prior position (built on first access, then cached). */
  readonly prior: Position;
  readonly move: string;
  readonly kind: RetractionKind;
  /** FEN letter of the piece the move captured, or null. */
  readonly uncaptured: string | null;
}

/**
 * Most callers only look at a few priors, so each one is built on demand from a private copy
 * of Q's board plus the candidate's few square changes.
 */
class LazyRetraction implements Retraction {
  #prior: Position | null = null;

  constructor(
    readonly move: string,
    readonly kind: RetractionKind,
    readonly uncaptured: string | null,
    private readonly base: Int8Array,
    private readonly changes: readonly number[],
    private readonly turn: Side,
    private readonly castling: number,
    private readonly epSquare: number,
    private readonly fullmove: number,
  ) {}

  get prior(): Position {
    if (this.#prior === null) {
      const prior = new Position(4);
      prior.board.set(this.base);
      for (let i = 0; i < this.changes.length; i += 2) {
        prior.board[this.changes[i]!] = this.changes[i + 1]!;
      }
      prior.turn = this.turn;
      prior.castling = this.castling;
      prior.epSquare = this.epSquare;
      prior.halfmove = 0;
      prior.fullmove = this.fullmove;
      // Ranks 8 down to 1, like parseFen, so "the first king" means the same thing.
      for (let i = 0; i < 128; i++) {
        const sq = (7 - (i >> 4)) * 16 + (i & 15);
        const piece = prior.board[sq]!;
        if ((sq & 0x88) !== 0 || piece === 0) continue;
        prior.counts[piece + 6]!++;
        const side = piece > 0 ? WHITE : BLACK;
        if ((piece === KING || piece === -KING) && prior.kingSquare[side] === NO_SQUARE) {
          prior.kingSquare[side] = sq;
        }
      }
      const hash = computeHash(prior);
      prior.hashHi = hash.hi;
      prior.hashLo = hash.lo;
      this.#prior = prior;
    }
    return this.#prior;
  }
}

/** Enemy pieces an un-capture can put back (never a king). */
const UNCAPTURABLE = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN] as const;

/** One candidate prior position, described as changes to Q's board. */
interface Candidate {
  /** Flat [square, piece, square, piece, ...] to write over Q's board. */
  changes: number[];
  from: number;
  to: number;
  promotion: number;
  kind: RetractionKind;
  /** Piece code put back by an un-capture, or 0. */
  uncaptured: number;
  epSquare: number;
  /** Castling right an un-castling restores, or 0. */
  addedRight: number;
}

interface Ctx {
  q: Position;
  retractor: Side;
  /** +1 if the retractor is White, -1 if Black. */
  sign: number;
  /** +16 if the retractor is White (its pawns move up the board), -16 if Black. */
  forward: number;
  opponent: Material;
  /** Scratch position: Q's board with a candidate's changes applied, then reverted. */
  work: Position;
  /** Private copy of Q's board that the lazy priors are built from. */
  base: Int8Array;
  buffer: Int32Array;
  out: Retraction[];
  /**
   * The un-capture variants of one move (pawn, knight, ... put back on `to`) differ only in
   * which enemy piece stands on `to`, which doesn't change what the mover can generate, so the
   * generator's answer is reused across them.
   */
  lastLookup: string;
  lastMove: number;
}

/**
 * Every retraction of `q` (SPEC §5.3): all prior positions P′ and moves m such that playing m
 * in P′ gives `q`. The retractor is the side not to move in `q`.
 *
 * Candidates come from geometry (pieces moved backwards, enemy pieces put back, promotions
 * undone, castling undone). Each one is then confirmed by forward generation in P′: the move
 * must be legal there and must give exactly `q`'s placement, keep every castling right `q`
 * states, and give `q`'s en passant square if `q` states one. So every retraction returned is
 * sound by construction.
 */
export function retractions(q: Position): Retraction[] {
  const retractor: Side = q.turn === WHITE ? BLACK : WHITE;
  const work = new Position(4);
  work.board.set(q.board);
  work.counts.set(q.counts);
  const ctx: Ctx = {
    q,
    retractor,
    sign: retractor === WHITE ? 1 : -1,
    forward: retractor === WHITE ? 16 : -16,
    opponent: material(q.board, q.turn),
    work,
    base: q.board.slice(),
    buffer: new Int32Array(MAX_MOVES),
    out: [],
    lastLookup: '',
    lastMove: -1,
  };
  const b = q.board;

  if (q.epSquare !== NO_SQUARE) {
    // A stated en passant square: the only possible last move is that double push.
    const pawnSquare = q.epSquare + ctx.forward;
    const start = q.epSquare - ctx.forward;
    if (
      (pawnSquare & 0x88) === 0 &&
      (start & 0x88) === 0 &&
      b[pawnSquare] === ctx.sign * PAWN &&
      b[q.epSquare] === 0 &&
      b[start] === 0
    ) {
      plainMove(ctx, start, pawnSquare, ctx.sign * PAWN, 0, 'normal');
    }
    return ctx.out;
  }

  for (let sq = 0; sq < 128; sq++) {
    if ((sq & 0x88) !== 0) continue;
    const piece = b[sq]! * ctx.sign;
    if (piece <= 0) continue;
    switch (piece) {
      case PAWN:
        retractPawn(ctx, sq);
        break;
      case KNIGHT:
        retractSteps(ctx, sq, KNIGHT_STEPS);
        break;
      case KING:
        retractSteps(ctx, sq, KING_STEPS);
        break;
      case BISHOP:
        retractSlides(ctx, sq, BISHOP_STEPS);
        break;
      case ROOK:
        retractSlides(ctx, sq, ROOK_STEPS);
        break;
      default: // QUEEN
        retractSlides(ctx, sq, BISHOP_STEPS);
        retractSlides(ctx, sq, ROOK_STEPS);
    }
    if (piece !== PAWN && piece !== KING && rankOf(sq) === (retractor === WHITE ? 7 : 0)) {
      retractPromotion(ctx, sq, piece);
    }
  }
  retractCastling(ctx);
  return ctx.out;
}

/** The piece on `to` came from the empty square `from`: plain, or capturing something on `to`. */
function moveBack(ctx: Ctx, from: number, to: number, placed: number, promotion: number): void {
  plainMove(ctx, from, to, placed, promotion, promotion === 0 ? 'normal' : 'unpromotion');
  const kind = promotion === 0 ? 'uncapture' : 'unpromotion-uncapture';
  for (const type of UNCAPTURABLE) uncapture(ctx, from, to, placed, promotion, type, kind);
}

function retractSteps(ctx: Ctx, to: number, steps: readonly number[]): void {
  for (const d of steps) {
    const from = to + d;
    if ((from & 0x88) === 0 && ctx.q.board[from] === 0)
      moveBack(ctx, from, to, ctx.q.board[to]!, 0);
  }
}

function retractSlides(ctx: Ctx, to: number, steps: readonly number[]): void {
  for (const d of steps) {
    for (let from = to + d; (from & 0x88) === 0 && ctx.q.board[from] === 0; from += d) {
      moveBack(ctx, from, to, ctx.q.board[to]!, 0);
    }
  }
}

function retractPawn(ctx: Ctx, to: number): void {
  const b = ctx.q.board;
  const pawn = ctx.sign * PAWN;
  // Ranks from the retractor's point of view: 0 = its first rank.
  const relRank = ctx.retractor === WHITE ? rankOf(to) : 7 - rankOf(to);
  if (relRank <= 1 || relRank === 7) return; // never moved, or impossible

  // `back` is on the retractor's second rank or higher, so a pawn may stand there.
  const back = to - ctx.forward;
  if (b[back] === 0) {
    plainMove(ctx, back, to, pawn, 0, 'normal');
    const twoBack = back - ctx.forward;
    if (relRank === 3 && b[twoBack] === 0) plainMove(ctx, twoBack, to, pawn, 0, 'normal');
  }

  for (const from of [back - 1, back + 1]) {
    if ((from & 0x88) !== 0 || b[from] !== 0) continue;
    // A diagonal pawn move is always a capture.
    for (const type of UNCAPTURABLE) uncapture(ctx, from, to, pawn, 0, type, 'uncapture');
    // En passant: the captured pawn stood beside `from`, having just double-pushed past `to`.
    const captured = to - ctx.forward;
    const enemyStart = to + ctx.forward;
    if (
      relRank === 5 &&
      b[captured] === 0 &&
      (enemyStart & 0x88) === 0 &&
      b[enemyStart] === 0 &&
      canAdd(ctx, PAWN, captured)
    ) {
      confirm(ctx, {
        changes: [to, 0, from, pawn, captured, -pawn],
        from,
        to,
        promotion: 0,
        kind: 'un-en-passant',
        uncaptured: -pawn,
        epSquare: to,
        addedRight: 0,
      });
    }
  }
}

function retractPromotion(ctx: Ctx, to: number, type: number): void {
  const pawn = ctx.sign * PAWN;
  const from = to - ctx.forward;
  if (ctx.q.board[from] === 0) plainMove(ctx, from, to, pawn, type, 'unpromotion');
  for (const diagonal of [from - 1, from + 1]) {
    if ((diagonal & 0x88) !== 0 || ctx.q.board[diagonal] !== 0) continue;
    for (const captured of UNCAPTURABLE) {
      if (captured === PAWN) continue; // no pawn stands on a last rank
      uncapture(ctx, diagonal, to, pawn, type, captured, 'unpromotion-uncapture');
    }
  }
}

function retractCastling(ctx: Ctx): void {
  const b = ctx.q.board;
  const white = ctx.retractor === WHITE;
  const king = ctx.sign * KING;
  const rook = ctx.sign * ROOK;
  const e = white ? E1 : E8;
  const [f, g, h] = white ? [F1, G1, H1] : [F8, G8, H8];
  if (b[g] === king && b[f] === rook && b[e] === 0 && b[h] === 0) {
    confirm(ctx, {
      changes: [g, 0, f, 0, e, king, h, rook],
      from: e,
      to: g,
      promotion: 0,
      kind: 'uncastle',
      uncaptured: 0,
      epSquare: NO_SQUARE,
      addedRight: white ? WHITE_KINGSIDE : BLACK_KINGSIDE,
    });
  }
  const [a, bSq, c, d] = white ? [A1, B1, C1, D1] : [A8, B8, C8, D8];
  if (b[c] === king && b[d] === rook && b[e] === 0 && b[bSq] === 0 && b[a] === 0) {
    confirm(ctx, {
      changes: [c, 0, d, 0, e, king, a, rook],
      from: e,
      to: c,
      promotion: 0,
      kind: 'uncastle',
      uncaptured: 0,
      epSquare: NO_SQUARE,
      addedRight: white ? WHITE_QUEENSIDE : BLACK_QUEENSIDE,
    });
  }
}

/** A move without a capture: `placed` goes back to `from`, `to` becomes empty. */
function plainMove(
  ctx: Ctx,
  from: number,
  to: number,
  placed: number,
  promotion: number,
  kind: RetractionKind,
): void {
  confirm(ctx, {
    changes: [to, 0, from, placed],
    from,
    to,
    promotion,
    kind,
    uncaptured: 0,
    epSquare: NO_SQUARE,
    addedRight: 0,
  });
}

/** Like plainMove, and an enemy piece of `type` reappears on `to`. */
function uncapture(
  ctx: Ctx,
  from: number,
  to: number,
  placed: number,
  promotion: number,
  type: number,
  kind: RetractionKind,
): void {
  const relRank = ctx.retractor === WHITE ? rankOf(to) : 7 - rankOf(to);
  if (type === PAWN && (relRank === 0 || relRank === 7)) return;
  if (!canAdd(ctx, type, to)) return;
  const enemy = -ctx.sign * type;
  confirm(ctx, {
    changes: [to, enemy, from, placed],
    from,
    to,
    promotion,
    kind,
    uncaptured: enemy,
    epSquare: NO_SQUARE,
    addedRight: 0,
  });
}

/**
 * Whether the opponent could have had one more piece of `type` (on `square`, for a bishop's
 * colour) and still pass TOO_MANY_PIECES, TOO_MANY_PAWNS and PROMOTION_EXCESS (SPEC §5.3).
 */
function canAdd(ctx: Ctx, type: number, square: number): boolean {
  const m: Material = { ...ctx.opponent };
  m.pieces++;
  if (type === PAWN) m.pawns++;
  else if (type === KNIGHT) m.knights++;
  else if (type === BISHOP) {
    if (isLightSquare(square)) m.lightBishops++;
    else m.darkBishops++;
  } else if (type === ROOK) m.rooks++;
  else m.queens++;
  return m.pieces <= 16 && m.pawns <= 8 && m.pawns + minPromotions(m) <= 8;
}

/**
 * Applies a candidate to the scratch position and keeps it only if (1) the side to move in `q`
 * isn't in check there, and (2) the move is legal there and gives `q`. A real Position is built
 * only for candidates that pass.
 */
function confirm(ctx: Ctx, c: Candidate): void {
  const { q, work } = ctx;
  const board = work.board;
  const saved: number[] = [];
  for (let i = 0; i < c.changes.length; i += 2) {
    const sq = c.changes[i]!;
    saved.push(sq, board[sq]!);
    board[sq] = c.changes[i + 1]!;
  }
  try {
    // (1) It was the retractor's turn, so the other side's kings can't be attacked.
    for (const king of ctx.opponent.kings) {
      if (isAttacked(board, king, ctx.retractor)) return;
    }

    work.turn = ctx.retractor;
    work.castling = q.castling | c.addedRight;
    work.epSquare = c.epSquare;
    work.kingSquare[q.turn] = q.kingSquare[q.turn]!;
    const movedKing = board[c.from] === ctx.sign * KING;
    work.kingSquare[ctx.retractor] = movedKing ? c.from : q.kingSquare[ctx.retractor]!;

    // (2) Forward generation: the move generator must produce this move in P′, and playing it
    // must not leave the retractor's own king attacked (so it's legal) and must give Q.
    const lookup = `${c.kind}:${String(c.from)}:${String(c.to)}:${String(c.promotion)}`;
    if (lookup !== ctx.lastLookup || c.uncaptured === 0) {
      ctx.lastLookup = lookup;
      ctx.lastMove = findPseudoMove(work, c.from, c.to, c.promotion, ctx.buffer);
    }
    const m = ctx.lastMove;
    if (m < 0) return;
    makeMove(work, m);
    const ownKing = work.kingSquare[ctx.retractor]!;
    const matches =
      (ownKing < 0 || !isAttacked(board, ownKing, q.turn)) &&
      sameBoard(board, q.board) &&
      (work.castling & q.castling) === q.castling &&
      (q.epSquare === NO_SQUARE || work.epSquare === q.epSquare);
    unmakeMove(work);
    if (matches) {
      // Clocks can't be known: halfmove 0, move number one back when Black made the last move.
      const fullmove = ctx.retractor === BLACK ? Math.max(1, q.fullmove - 1) : q.fullmove;
      ctx.out.push(
        new LazyRetraction(
          moveToUci(m),
          c.kind,
          c.uncaptured === 0 ? null : pieceLetter(c.uncaptured),
          ctx.base,
          c.changes,
          ctx.retractor,
          work.castling,
          work.epSquare,
          fullmove,
        ),
      );
    }
  } finally {
    for (let i = saved.length - 2; i >= 0; i -= 2) board[saved[i]!] = saved[i + 1]!;
  }
}

function sameBoard(a: Int8Array, b: Int8Array): boolean {
  for (let i = 0; i < 128; i++) if (a[i] !== b[i]) return false;
  return true;
}
