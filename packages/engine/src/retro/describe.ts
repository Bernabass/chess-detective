import { BLACK, PAWN, squareFromName } from '../core/board';
import { COLOR_NAME, joinAnd, pieceName } from './findings';
import type { Retraction } from './retract';

const LETTERS = '  NBRQK';

/**
 * Long algebraic notation for a retraction's move, from the prior position: "Bf1xb5", "e7-e5",
 * "e5xd6 e.p.", "b7-b8=Q", "O-O". Black moves get a leading "…".
 */
export function retractionNotation(r: Retraction): string {
  const prior = r.prior;
  const from = squareFromName(r.move.slice(0, 2));
  const piece = prior.board[from]!;
  let text: string;
  if (r.kind === 'uncastle') {
    text = r.move[2] === 'g' ? 'O-O' : 'O-O-O';
  } else {
    const type = Math.abs(piece);
    const letter = type === PAWN ? '' : LETTERS.charAt(type);
    const capture = r.uncaptured !== null ? 'x' : '-';
    text = `${letter}${r.move.slice(0, 2)}${capture}${r.move.slice(2, 4)}`;
    if (r.move.length === 5) text += `=${r.move.charAt(4).toUpperCase()}`;
    if (r.kind === 'un-en-passant') text += ' e.p.';
  }
  return prior.turn === BLACK ? `…${text}` : text;
}

/** "White's last move could have been Bf1xb5, capturing a black knight." */
export function retractionDescription(r: Retraction): string {
  const mover = COLOR_NAME[r.prior.turn];
  const victim = COLOR_NAME[r.prior.turn === BLACK ? 0 : 1].toLowerCase();
  const capture =
    r.uncaptured === null
      ? ''
      : `, capturing a ${victim} ${pieceName(PIECE_OF[r.uncaptured.toLowerCase()] ?? 0)}`;
  return `${mover}'s last move could have been ${retractionNotation(r)}${capture}.`;
}

const PIECE_OF: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5 };

/**
 * "pawn, knight or queen" for a list of FEN letters, in P N B R Q order. `enPassant` marks the
 * pawn: "only" when the pawn can only have been taken en passant, "also" when it may have been.
 */
export function capturedList(
  letters: readonly string[],
  enPassant: 'none' | 'only' | 'also' = 'none',
): string {
  const set = new Set(letters.map((l) => l.toLowerCase()));
  if (enPassant !== 'none') set.add('p');
  const ordered = [...set].sort((a, b) => (PIECE_OF[a] ?? 0) - (PIECE_OF[b] ?? 0));
  return joinAnd(
    ordered.map((l) => {
      const name = pieceName(PIECE_OF[l] ?? 0);
      if (l !== 'p' || enPassant === 'none') return name;
      return enPassant === 'only' ? `${name} (en passant)` : `${name} (possibly en passant)`;
    }),
    'or',
  );
}
