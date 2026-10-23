import { createElement } from 'react';

export type PieceRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PieceColor = 'white' | 'black';

/** A piece image from the board's piece set (chessground's cburnett CSS), sized by its parent. */
export function PieceIcon({ role, color }: { role: PieceRole; color: PieceColor }) {
  // chessground styles a <piece> element inside .cg-wrap; React renders unknown tags as-is.
  return (
    <span className="cg-wrap piece-icon" aria-hidden="true">
      {createElement('piece', { className: `${role} ${color}` })}
    </span>
  );
}
