import {
  initialPosition,
  makeMove,
  moveToUci,
  pieceAt,
  squareFromName,
  uciToMove,
  inCheck,
  moveToSan,
  type Move,
  type Position,
} from '@retrograde/engine';

/** What a move does, read from the board before it is played (public engine API only). */
export interface MoveInfo {
  uci: string;
  from: string;
  to: string;
  /** FEN letter of the moving piece (uppercase for White). */
  piece: string;
  /** FEN letter of the captured piece, or null. En passant captures a pawn. */
  captured: string | null;
  enPassant: boolean;
  castling: boolean;
  /** FEN letter of the promotion piece (case of the mover), or null. */
  promotion: string | null;
  /** Whether the move gives check. */
  check: boolean;
}

/** Describes `m` in `p`, then plays it on `p`. */
export function playAndDescribe(p: Position, m: Move): MoveInfo {
  const uci = moveToUci(m);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = pieceAt(p, squareFromName(from)) ?? '?';
  let captured = pieceAt(p, squareFromName(to));
  const isPawn = piece === 'P' || piece === 'p';
  const enPassant = isPawn && from.charCodeAt(0) !== to.charCodeAt(0) && captured === null;
  if (enPassant) captured = piece === 'P' ? 'p' : 'P';
  const castling =
    (piece === 'K' || piece === 'k') && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;
  const promotionLetter = uci.length === 5 ? uci.charAt(4) : null;
  const promotion =
    promotionLetter === null
      ? null
      : piece === 'P'
        ? promotionLetter.toUpperCase()
        : promotionLetter;
  makeMove(p, m);
  const check = inCheck(p);
  return { uci, from, to, piece, captured, enPassant, castling, promotion, check };
}

/** Replays UCI moves from the start, describing each one. Throws on an illegal move. */
export function describeGame(ucis: readonly string[]): MoveInfo[] {
  const p = initialPosition();
  return ucis.map((uci) => {
    const r = uciToMove(p, uci);
    if (!r.ok) throw new Error(`illegal move ${uci}: ${r.error}`);
    return playAndDescribe(p, r.value);
  });
}

/** A UCI game in numbered SAN ("1.e4 e5 2.Nf3"). Throws on an illegal move. */
export function sanLine(ucis: readonly string[]): string {
  const p = initialPosition();
  return ucis
    .map((uci, i) => {
      const r = uciToMove(p, uci);
      if (!r.ok) throw new Error(`illegal move ${uci}: ${r.error}`);
      const san = moveToSan(p, r.value);
      makeMove(p, r.value);
      return i % 2 === 0 ? `${String(i / 2 + 1)}.${san}` : san;
    })
    .join(' ');
}
