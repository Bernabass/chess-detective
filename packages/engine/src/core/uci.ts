import { err, ok, type Result } from '../util/result';
import { squareFromName, squareName } from './board';
import { legalMoves } from './movegen';
import { moveFrom, movePromotion, moveTo, type Move } from './move';
import type { Position } from './position';

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const PROMOTION_LETTERS = '  nbrq'; // index = piece type

/** UCI text like "e2e4", "e7e8q" or "e1g1" (castling is written as the king's move). */
export function moveToUci(m: Move): string {
  const promotion = movePromotion(m);
  return (
    squareName(moveFrom(m)) +
    squareName(moveTo(m)) +
    (promotion === 0 ? '' : PROMOTION_LETTERS.charAt(promotion))
  );
}

/** The legal move written as `uci` in this position, or an error explaining why there isn't one. */
export function uciToMove(p: Position, uci: string): Result<Move, string> {
  const match = UCI.exec(uci);
  if (!match) return err(`"${uci}" is malformed: expected UCI like e2e4 or e7e8q.`);
  // Groups 1 and 2 are required by the pattern; group 3 (promotion) is optional.
  const from = squareFromName(match[1]!);
  const to = squareFromName(match[2]!);
  const promotionLetter = match[3];
  const promotion = promotionLetter === undefined ? 0 : PROMOTION_LETTERS.indexOf(promotionLetter);

  let needsPromotion = false;
  for (const m of legalMoves(p)) {
    if (moveFrom(m) !== from || moveTo(m) !== to) continue;
    if (movePromotion(m) === promotion) return ok(m);
    if (promotion === 0) needsPromotion = true;
  }
  if (needsPromotion) {
    return err(`"${uci}" needs a promotion piece (q, r, b or n), e.g. ${uci}q.`);
  }
  return err(`"${uci}" is illegal in this position.`);
}
