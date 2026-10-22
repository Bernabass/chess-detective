/** Rule ids, one per line of SPEC §5.2. */
export type RuleId =
  | 'KING_COUNT'
  | 'PAWN_ON_BACK_RANK'
  | 'TOO_MANY_PIECES'
  | 'TOO_MANY_PAWNS'
  | 'PROMOTION_EXCESS'
  | 'OPPONENT_IN_CHECK'
  | 'TOO_MANY_CHECKERS'
  | 'PAWN_STRUCTURE_IMPOSSIBLE'
  | 'PAWN_CAPTURES_EXCEED_MISSING'
  | 'CASTLING_RIGHTS_INCONSISTENT'
  | 'EN_PASSANT_INCONSISTENT'
  | 'NO_POSSIBLE_LAST_MOVE'
  | 'NO_POSSIBLE_HISTORY'
  | 'PROMOTED_PIECE_REQUIRED'
  | 'CAPTURES_REQUIRED'
  | 'CASTLING_LOST'
  | 'LAST_MOVE_FORCED';

/**
 * `illegal`: a certain contradiction. `deduction`: a true fact about the position's history
 * (the Lab's "detective notes").
 */
export type Severity = 'illegal' | 'deduction';

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** Plain English, shown in the Lab. */
  message: string;
  /** Squares to highlight, like "e4". */
  squares: string[];
  /** Arrows to draw, [from, to]. */
  arrows?: [string, string][];
}

export const COLOR_NAME = ['White', 'Black'] as const;

const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;

/** "pawn", "knight", ... for a piece code of either colour. */
export function pieceName(piece: number): string {
  return PIECE_NAMES[Math.abs(piece)] ?? '';
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[], conjunction = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1] ?? ''}`;
}

/** "1 pawn", "2 pawns". */
export function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}
