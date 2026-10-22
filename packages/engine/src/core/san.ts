import { err, ok, type Result } from '../util/result';
import { PAWN, fileOf, rankOf, squareFromName, squareName } from './board';
import { makeMove, unmakeMove } from './makemove';
import { hasLegalMove, inCheck, legalMoves } from './movegen';
import {
  isCapture,
  isCastle,
  isPromotion,
  moveFrom,
  movePromotion,
  moveTo,
  type Move,
} from './move';
import type { Position } from './position';

const LETTERS = '  NBRQK'; // index = piece type
const SAN = /^([NBRQK])?([a-h])?([1-8])?([x:])?([a-h][1-8])(?:=?([NBRQnbrq]))?$/;
const CASTLING = /^[O0o]-[O0o](-[O0o])?$/;

/** Standard Algebraic Notation for a legal move, with minimal disambiguation and +/# suffix. */
export function moveToSan(p: Position, m: Move): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const piece = p.board[from]!;
  const type = Math.abs(piece);
  let san: string;

  if (isCastle(m)) {
    san = fileOf(to) === 6 ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
    san = isCapture(m) ? `${squareName(from).charAt(0)}x${squareName(to)}` : squareName(to);
    if (isPromotion(m)) san += `=${LETTERS.charAt(movePromotion(m))}`;
  } else {
    san = LETTERS.charAt(type);
    // Other pieces of the same kind that could also move to `to`.
    const rivals = legalMoves(p).filter(
      (other) =>
        moveTo(other) === to && moveFrom(other) !== from && p.board[moveFrom(other)] === piece,
    );
    if (rivals.length > 0) {
      const sameFile = rivals.some((r) => fileOf(moveFrom(r)) === fileOf(from));
      const sameRank = rivals.some((r) => rankOf(moveFrom(r)) === rankOf(from));
      const name = squareName(from);
      if (!sameFile) san += name.charAt(0);
      else if (!sameRank) san += name.charAt(1);
      else san += name;
    }
    if (isCapture(m)) san += 'x';
    san += squareName(to);
  }

  makeMove(p, m);
  if (inCheck(p)) san += hasLegalMove(p) ? '+' : '#';
  unmakeMove(p);
  return san;
}

/**
 * Reads SAN leniently: check marks and annotations (+ # ! ?) are optional, castling may use
 * zeros or lowercase letters (also mixed, like O-0), promotion letters may be lowercase or lack
 * "=", the capture "x" (or ":") may be missing, and extra disambiguation is fine (Ng1f3, or a
 * pawn's source rank). Rejected: ambiguous, illegal and malformed input, and an "x" on a move
 * that captures nothing.
 */
export function sanToMove(p: Position, san: string): Result<Move, string> {
  const text = san.trim().replace(/[+#!?]+$/, '');
  const moves = legalMoves(p);

  if (CASTLING.test(text)) {
    const kingFile = text.length > 3 ? 2 : 6;
    const castle = moves.find((m) => isCastle(m) && fileOf(moveTo(m)) === kingFile);
    return castle === undefined ? err(`"${san}" is illegal in this position.`) : ok(castle);
  }

  const match = SAN.exec(text);
  if (!match) return err(`"${san}" is not valid SAN (examples: e4, Nf3, exd5, O-O, e8=Q).`);
  const letter = match[1];
  const fromFile = match[2];
  const fromRank = match[3];
  const captureMark = match[4] !== undefined;
  const toName = match[5]!; // the destination group is required by the pattern
  const promotionLetter = match[6];
  const type = letter === undefined ? PAWN : LETTERS.indexOf(letter);
  const to = squareFromName(toName);
  const promotion =
    promotionLetter === undefined ? 0 : LETTERS.indexOf(promotionLetter.toUpperCase());

  const matches: Move[] = [];
  let needsPromotion = false;
  for (const m of moves) {
    const from = moveFrom(m);
    if (isCastle(m) || moveTo(m) !== to || Math.abs(p.board[from]!) !== type) continue;
    if (fromFile !== undefined && !squareName(from).startsWith(fromFile)) continue;
    if (fromRank !== undefined && !squareName(from).endsWith(fromRank)) continue;
    if (captureMark && !isCapture(m)) continue;
    // A pawn move without a source file is a push, never a capture ("d5" isn't "exd5").
    if (type === PAWN && fromFile === undefined && fileOf(from) !== fileOf(to)) continue;
    if (isPromotion(m)) {
      if (promotion === 0) {
        needsPromotion = true;
        continue;
      }
      if (movePromotion(m) !== promotion) continue;
    } else if (promotion !== 0) {
      continue;
    }
    matches.push(m);
  }

  if (matches.length === 1) return ok(matches[0]!);
  if (matches.length > 1) {
    const options = matches.map((m) => moveToSan(p, m)).join(', ');
    return err(`"${san}" is ambiguous: it could be ${options}.`);
  }
  if (needsPromotion) return err(`"${san}" needs a promotion piece, e.g. ${text}=Q.`);
  return err(`"${san}" is illegal in this position.`);
}
