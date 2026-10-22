import { attackersOf, isAttacked } from '../core/attacks';
import {
  A1,
  A8,
  BISHOP,
  BLACK,
  BLACK_KINGSIDE,
  BLACK_QUEENSIDE,
  E1,
  E8,
  H1,
  H8,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  fileOf,
  rankOf,
  squareName,
  type Side,
} from '../core/board';
import type { Position } from '../core/position';
import { COLOR_NAME, joinAnd, pieceName, plural, type Finding } from './findings';
import { pawnAccounting } from './pawns';

/** What one side has on the board. */
export interface Material {
  pieces: number;
  pawns: number;
  knights: number;
  lightBishops: number;
  darkBishops: number;
  rooks: number;
  queens: number;
  kings: number[];
}

export function isLightSquare(sq: number): boolean {
  return (fileOf(sq) + rankOf(sq)) % 2 === 1;
}

export function material(board: Int8Array, side: Side): Material {
  const sign = side === WHITE ? 1 : -1;
  const m: Material = {
    pieces: 0,
    pawns: 0,
    knights: 0,
    lightBishops: 0,
    darkBishops: 0,
    rooks: 0,
    queens: 0,
    kings: [],
  };
  for (let sq = 0; sq < 128; sq++) {
    if ((sq & 0x88) !== 0) continue;
    const piece = board[sq]! * sign;
    if (piece <= 0) continue;
    m.pieces++;
    if (piece === PAWN) m.pawns++;
    else if (piece === KNIGHT) m.knights++;
    else if (piece === BISHOP) {
      if (isLightSquare(sq)) m.lightBishops++;
      else m.darkBishops++;
    } else if (piece === ROOK) m.rooks++;
    else if (piece === QUEEN) m.queens++;
    else m.kings.push(sq);
  }
  return m;
}

/** Pieces beyond the starting set: each must be a promoted pawn (SPEC §5.2 PROMOTION_EXCESS). */
export function minPromotions(m: Material): number {
  return (
    Math.max(0, m.queens - 1) +
    Math.max(0, m.rooks - 2) +
    Math.max(0, m.knights - 2) +
    Math.max(0, m.lightBishops - 1) +
    Math.max(0, m.darkBishops - 1)
  );
}

/** "2 queens and 2 dark-squared bishops": the parts of `m` that exceed the starting set. */
function excessParts(m: Material): string[] {
  const parts: string[] = [];
  if (m.queens > 1) parts.push(plural(m.queens, 'queen'));
  if (m.rooks > 2) parts.push(plural(m.rooks, 'rook'));
  if (m.knights > 2) parts.push(plural(m.knights, 'knight'));
  if (m.lightBishops > 1) parts.push(plural(m.lightBishops, 'light-squared bishop'));
  if (m.darkBishops > 1) parts.push(plural(m.darkBishops, 'dark-squared bishop'));
  return parts;
}

interface Context {
  p: Position;
  material: [Material, Material];
}

type Rule = (ctx: Context) => Finding[];

function illegal(rule: Finding['rule'], message: string, squares: number[]): Finding {
  return { rule, severity: 'illegal', message, squares: squares.map(squareName) };
}

function deduction(rule: Finding['rule'], message: string, squares: number[]): Finding {
  return { rule, severity: 'deduction', message, squares: squares.map(squareName) };
}

const SIDES: readonly Side[] = [WHITE, BLACK];

const kingCount: Rule = ({ material: mat }) =>
  SIDES.flatMap((side) => {
    const kings = mat[side].kings;
    if (kings.length === 1) return [];
    const has = kings.length === 0 ? 'no king' : `${String(kings.length)} kings`;
    return [
      illegal(
        'KING_COUNT',
        `${COLOR_NAME[side]} has ${has}. Each side has exactly one king.`,
        kings,
      ),
    ];
  });

const pawnOnBackRank: Rule = ({ p }) => {
  const result: Finding[] = [];
  for (let sq = 0; sq < 128; sq++) {
    if ((sq & 0x88) !== 0 || (rankOf(sq) !== 0 && rankOf(sq) !== 7)) continue;
    const piece = p.board[sq]!;
    if (piece !== PAWN && piece !== -PAWN) continue;
    const color = piece > 0 ? 'white' : 'black';
    result.push(
      illegal(
        'PAWN_ON_BACK_RANK',
        `The ${color} pawn on ${squareName(sq)} is impossible: pawns never stand on the first or last rank.`,
        [sq],
      ),
    );
  }
  return result;
};

const tooManyPieces: Rule = ({ material: mat }) =>
  SIDES.flatMap((side) =>
    mat[side].pieces > 16
      ? [
          illegal(
            'TOO_MANY_PIECES',
            `${COLOR_NAME[side]} has ${String(mat[side].pieces)} pieces but started with 16.`,
            [],
          ),
        ]
      : [],
  );

const tooManyPawns: Rule = ({ material: mat }) =>
  SIDES.flatMap((side) =>
    mat[side].pawns > 8
      ? [
          illegal(
            'TOO_MANY_PAWNS',
            `${COLOR_NAME[side]} has ${String(mat[side].pawns)} pawns but started with 8.`,
            [],
          ),
        ]
      : [],
  );

const promotionExcess: Rule = ({ material: mat }) =>
  SIDES.flatMap((side) => {
    const m = mat[side];
    const promoted = minPromotions(m);
    if (promoted === 0 || m.pawns + promoted <= 8) return [];
    const atLeast =
      promoted === 1
        ? 'at least 1 is a promoted pawn'
        : `at least ${String(promoted)} are promoted pawns`;
    return [
      illegal(
        'PROMOTION_EXCESS',
        `${COLOR_NAME[side]} has ${joinAnd(excessParts(m))}, so ${atLeast}. With ${plural(m.pawns, 'pawn')} still on the board that makes ${String(m.pawns + promoted)} pawns, but ${COLOR_NAME[side]} only had 8.`,
        [],
      ),
    ];
  });

/** "the rook on e7 and the bishop on b5" */
function describeAttackers(board: Int8Array, squares: readonly number[]): string {
  return joinAnd(squares.map((sq) => `the ${pieceName(board[sq]!)} on ${squareName(sq)}`));
}

const opponentInCheck: Rule = ({ p, material: mat }) => {
  const mover = p.turn;
  const justMoved: Side = mover === WHITE ? BLACK : WHITE;
  for (const king of mat[justMoved].kings) {
    const attackers = attackersOf(p.board, king, mover);
    if (attackers.length === 0) continue;
    return [
      illegal(
        'OPPONENT_IN_CHECK',
        `It's ${COLOR_NAME[mover]} to move, but the ${COLOR_NAME[justMoved].toLowerCase()} king on ${squareName(king)} is in check from ${describeAttackers(p.board, attackers)}. ${COLOR_NAME[justMoved]}'s last move would have left its own king in check.`,
        [king, ...attackers],
      ),
    ];
  }
  return [];
};

const tooManyCheckers: Rule = ({ p, material: mat }) => {
  const mover = p.turn;
  const other: Side = mover === WHITE ? BLACK : WHITE;
  for (const king of mat[mover].kings) {
    const attackers = attackersOf(p.board, king, other);
    if (attackers.length <= 2) continue;
    return [
      illegal(
        'TOO_MANY_CHECKERS',
        `The ${COLOR_NAME[mover].toLowerCase()} king is in check from ${String(attackers.length)} pieces at once; one move can create at most a double check.`,
        [king, ...attackers],
      ),
    ];
  }
  return [];
};

function fileList(files: readonly number[]): string {
  const letters = files.map((f) => `${String.fromCharCode(97 + f)}-`);
  return `${joinAnd(letters)}${files.length === 1 ? 'file' : 'files'}`;
}

/** PAWN_STRUCTURE_IMPOSSIBLE, PAWN_CAPTURES_EXCEED_MISSING and CAPTURES_REQUIRED share one computation. */
const pawnAccountingRules: Rule = ({ p, material: mat }) =>
  SIDES.flatMap((side): Finding[] => {
    const color = COLOR_NAME[side].toLowerCase();
    const r = pawnAccounting(p.board, side);
    if (r.kind === 'skipped') return [];
    if (r.kind === 'impossible') {
      const squares = r.group.map(squareName).join(', ');
      return [
        illegal(
          'PAWN_STRUCTURE_IMPOSSIBLE',
          `${String(r.group.length)} ${color} pawns (${squares}) could only have started on the ${fileList(r.files)}, so the pawn on ${squareName(r.unmatched)} has no possible starting file.`,
          r.group,
        ),
      ];
    }
    if (r.minCaptures === 0) return [];
    const other: Side = side === WHITE ? BLACK : WHITE;
    const missing = Math.max(0, 16 - mat[other].pieces);
    if (r.minCaptures > missing) {
      const but =
        missing === 0
          ? `all 16 ${COLOR_NAME[other].toLowerCase()} pieces are still on the board`
          : `${COLOR_NAME[other]} is missing only ${plural(missing, 'piece')}`;
      return [
        illegal(
          'PAWN_CAPTURES_EXCEED_MISSING',
          `${COLOR_NAME[side]}'s pawns needed at least ${plural(r.minCaptures, 'capture')} to get where they are, but ${but}.`,
          r.capturingPawns,
        ),
      ];
    }
    return [
      deduction(
        'CAPTURES_REQUIRED',
        `${COLOR_NAME[side]}'s pawns made at least ${plural(r.minCaptures, 'capture')}.`,
        r.capturingPawns,
      ),
    ];
  });

interface CastlingRight {
  bit: number;
  side: Side;
  wing: 'kingside' | 'queenside';
  king: number;
  rook: number;
}

const RIGHTS: readonly CastlingRight[] = [
  { bit: WHITE_KINGSIDE, side: WHITE, wing: 'kingside', king: E1, rook: H1 },
  { bit: WHITE_QUEENSIDE, side: WHITE, wing: 'queenside', king: E1, rook: A1 },
  { bit: BLACK_KINGSIDE, side: BLACK, wing: 'kingside', king: E8, rook: H8 },
  { bit: BLACK_QUEENSIDE, side: BLACK, wing: 'queenside', king: E8, rook: A8 },
];

const castlingRules: Rule = ({ p, material: mat }) => {
  const result: Finding[] = [];
  for (const r of RIGHTS) {
    const sign = r.side === WHITE ? 1 : -1;
    const color = COLOR_NAME[r.side].toLowerCase();
    const kingHome = p.board[r.king] === sign * KING;
    const rookHome = p.board[r.rook] === sign * ROOK;
    if ((p.castling & r.bit) !== 0) {
      if (kingHome && rookHome) continue;
      const kings = mat[r.side].kings;
      const reason = kingHome
        ? `there is no ${color} rook on ${squareName(r.rook)}`
        : kings.length > 0
          ? `the ${color} king is on ${squareName(kings[0]!)}`
          : `there is no ${color} king on ${squareName(r.king)}`;
      result.push(
        illegal(
          'CASTLING_RIGHTS_INCONSISTENT',
          `The FEN says ${COLOR_NAME[r.side]} can castle ${r.wing}, but ${reason}.`,
          [r.king, r.rook],
        ),
      );
    } else if (!kingHome || !rookHome) {
      const reason = kingHome
        ? `the ${squareName(r.rook)} rook has moved or been captured`
        : `the ${color} king has left ${squareName(r.king)}`;
      result.push(
        deduction(
          'CASTLING_LOST',
          `${COLOR_NAME[r.side]} can no longer castle ${r.wing}: ${reason}.`,
          [kingHome ? r.rook : r.king],
        ),
      );
    }
  }
  return result;
};

const enPassantRule: Rule = ({ p }) => {
  const ep = p.epSquare;
  if (ep < 0) return [];
  const epName = squareName(ep);
  // The side that just moved, according to the square's rank: rank 6 means Black pushed.
  const pusher: Side = rankOf(ep) === 5 ? BLACK : WHITE;
  if (pusher === p.turn) {
    return [
      illegal(
        'EN_PASSANT_INCONSISTENT',
        `The FEN gives ${epName} as the en passant square, which means ${COLOR_NAME[pusher]} just double-pushed a pawn, but it's ${COLOR_NAME[p.turn]} to move.`,
        [ep],
      ),
    ];
  }
  const forward = pusher === WHITE ? 16 : -16;
  const pawnSquare = ep + forward;
  const startSquare = ep - forward;
  const push = `${COLOR_NAME[pusher]} just played ${squareName(startSquare)}-${squareName(pawnSquare)}`;
  const pawn = pusher === WHITE ? PAWN : -PAWN;
  let problem = '';
  if (p.board[pawnSquare] !== pawn) {
    problem = `there is no ${COLOR_NAME[pusher].toLowerCase()} pawn on ${squareName(pawnSquare)}`;
  } else if (p.board[ep] !== 0) {
    problem = `${epName} is occupied`;
  } else if (p.board[startSquare] !== 0) {
    problem = `${squareName(startSquare)} is occupied`;
  }
  if (problem === '') return [];
  return [
    illegal(
      'EN_PASSANT_INCONSISTENT',
      `The FEN gives ${epName} as the en passant square, so ${push}, but ${problem}.`,
      [ep, pawnSquare],
    ),
  ];
};

const promotedPieceRequired: Rule = ({ material: mat }) =>
  SIDES.flatMap((side) => {
    const m = mat[side];
    const promoted = minPromotions(m);
    if (promoted === 0 || m.pawns + promoted > 8) return []; // PROMOTION_EXCESS covers that
    const color = COLOR_NAME[side].toLowerCase();
    const subject =
      promoted === 1
        ? `At least 1 ${color} piece is a promoted pawn`
        : `At least ${String(promoted)} ${color} pieces are promoted pawns`;
    return [
      deduction(
        'PROMOTED_PIECE_REQUIRED',
        `${subject}: ${COLOR_NAME[side]} has ${joinAnd(excessParts(m))}.`,
        [],
      ),
    ];
  });

/** Rules that can prove a position illegal, in SPEC table order. */
const ILLEGAL_RULES: readonly Rule[] = [
  kingCount,
  pawnOnBackRank,
  tooManyPieces,
  tooManyPawns,
  promotionExcess,
  opponentInCheck,
  tooManyCheckers,
  pawnAccountingRules, // also yields the CAPTURES_REQUIRED deduction
  castlingRules, // also yields CASTLING_LOST deductions
  enPassantRule,
];

const DEDUCTION_RULES: readonly Rule[] = [promotedPieceRequired];

function context(p: Position): Context {
  return { p, material: [material(p.board, WHITE), material(p.board, BLACK)] };
}

/**
 * Every static finding (SPEC §5.2) for the position: illegal contradictions first, then
 * deductions. The last-move rules (NO_POSSIBLE_*, LAST_MOVE_FORCED) come from lastMoves.
 */
export function staticFindings(p: Position): Finding[] {
  const ctx = context(p);
  const all = [...ILLEGAL_RULES, ...DEDUCTION_RULES].flatMap((rule) => rule(ctx));
  return [
    ...all.filter((f) => f.severity === 'illegal'),
    ...all.filter((f) => f.severity === 'deduction'),
  ];
}

/** Whether any static rule proves the position illegal. Stops at the first rule that does. */
export function hasStaticContradiction(p: Position): boolean {
  // Cheap checks first: most positions in a retraction search pass them all.
  const ctx = context(p);
  for (const rule of ILLEGAL_RULES) {
    if (rule(ctx).some((f) => f.severity === 'illegal')) return true;
  }
  return false;
}

/** Whether `by` attacks any of `side`'s kings. */
export function anyKingAttacked(board: Int8Array, side: Side, by: Side): boolean {
  const king = side === WHITE ? KING : -KING;
  for (let sq = 0; sq < 128; sq++) {
    if ((sq & 0x88) === 0 && board[sq] === king && isAttacked(board, sq, by)) return true;
  }
  return false;
}
