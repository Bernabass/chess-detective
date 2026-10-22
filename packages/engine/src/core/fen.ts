import { err, ok, type Result } from '../util/result';
import {
  BLACK,
  BLACK_KINGSIDE,
  BLACK_QUEENSIDE,
  KING,
  NO_SQUARE,
  WHITE,
  WHITE_KINGSIDE,
  WHITE_QUEENSIDE,
  pieceFromLetter,
  pieceLetter,
  squareFromName,
  squareName,
} from './board';
import { Position } from './position';
import { computeHash } from './zobrist';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface FenError {
  field: 'fields' | 'placement' | 'side' | 'castling' | 'enPassant' | 'halfmove' | 'fullmove';
  message: string;
}

const CLOCK = /^\d{1,9}$/;

/**
 * Parses a FEN, checking syntax only (SPEC §4.2). Positions that are syntactically valid but
 * illegal (two kings, a pawn on the back rank, impossible castling rights) parse successfully;
 * deciding legality is the analyzer's job. Every broken field is reported, not just the first.
 */
export function parseFen(fen: string): Result<Position, FenError[]> {
  const text = fen.trim();
  const fields = text === '' ? [] : text.split(/\s+/);
  if (fields.length !== 4 && fields.length !== 6) {
    return err([
      {
        field: 'fields',
        message:
          fields.length === 0
            ? 'The FEN is empty.'
            : `A FEN has 6 space-separated fields (or 4 without the move clocks), but this one has ${String(fields.length)}.`,
      },
    ]);
  }
  const [placement = '', side = '', castling = '', enPassant = '', halfmove = '0', fullmove = '1'] =
    fields;

  const errors: FenError[] = [];
  const p = new Position();

  const placementError = parsePlacement(placement, p);
  if (placementError) errors.push({ field: 'placement', message: placementError });

  if (side === 'w' || side === 'b') {
    p.turn = side === 'w' ? WHITE : BLACK;
  } else {
    errors.push({ field: 'side', message: `Side to move must be "w" or "b", not "${side}".` });
  }

  if (castling === '-') {
    p.castling = 0;
  } else if (/^K?Q?k?q?$/.test(castling)) {
    if (castling.includes('K')) p.castling |= WHITE_KINGSIDE;
    if (castling.includes('Q')) p.castling |= WHITE_QUEENSIDE;
    if (castling.includes('k')) p.castling |= BLACK_KINGSIDE;
    if (castling.includes('q')) p.castling |= BLACK_QUEENSIDE;
  } else {
    errors.push({
      field: 'castling',
      message: `Castling rights must be "-" or letters from KQkq in that order, not "${castling}".`,
    });
  }

  if (enPassant === '-') {
    p.epSquare = NO_SQUARE;
  } else if (/^[a-h][36]$/.test(enPassant)) {
    p.epSquare = squareFromName(enPassant);
  } else {
    errors.push({
      field: 'enPassant',
      message: `The en passant square must be "-" or a square on rank 3 or 6, not "${enPassant}".`,
    });
  }

  if (CLOCK.test(halfmove)) {
    p.halfmove = Number(halfmove);
  } else {
    errors.push({
      field: 'halfmove',
      message: `The halfmove clock must be a whole number of at most 9 digits, not "${halfmove}".`,
    });
  }
  if (CLOCK.test(fullmove)) {
    p.fullmove = Number(fullmove);
  } else {
    errors.push({
      field: 'fullmove',
      message: `The move number must be a whole number of at most 9 digits, not "${fullmove}".`,
    });
  }

  if (errors.length > 0) return err(errors);
  const hash = computeHash(p);
  p.hashHi = hash.hi;
  p.hashLo = hash.lo;
  return ok(p);
}

/** Fills the board from the placement field; returns an error message or "" if it's valid. */
function parsePlacement(placement: string, p: Position): string {
  const ranks = placement.split('/');
  if (ranks.length !== 8) {
    return `The board needs 8 ranks separated by "/", but this one has ${String(ranks.length)}.`;
  }
  for (let i = 0; i < 8; i++) {
    const rankNumber = 8 - i;
    const row = ranks[i] ?? '';
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const piece = pieceFromLetter(ch);
        if (piece === 0) {
          return `Unexpected character "${ch}" in rank ${String(rankNumber)}: use pnbrqk/PNBRQK for pieces and 1-8 for empty squares.`;
        }
        if (file < 8) {
          const sq = (rankNumber - 1) * 16 + file;
          p.board[sq] = piece;
          p.counts[piece + 6]!++;
          const side = piece > 0 ? WHITE : BLACK;
          if ((piece === KING || piece === -KING) && p.kingSquare[side] === NO_SQUARE) {
            p.kingSquare[side] = sq;
          }
        }
        file++;
      }
    }
    if (file !== 8) {
      return `Rank ${String(rankNumber)} describes ${String(file)} squares instead of 8.`;
    }
  }
  return '';
}

/** Canonical FEN for the position. */
export function toFen(p: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = p.board[rank * 16 + file]!;
      if (piece === 0) {
        empty++;
        continue;
      }
      if (empty > 0) row += String(empty);
      empty = 0;
      row += pieceLetter(piece);
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  let castling = '';
  if (p.castling & WHITE_KINGSIDE) castling += 'K';
  if (p.castling & WHITE_QUEENSIDE) castling += 'Q';
  if (p.castling & BLACK_KINGSIDE) castling += 'k';
  if (p.castling & BLACK_QUEENSIDE) castling += 'q';
  return [
    rows.join('/'),
    p.turn === WHITE ? 'w' : 'b',
    castling || '-',
    p.epSquare === NO_SQUARE ? '-' : squareName(p.epSquare),
    String(p.halfmove),
    String(p.fullmove),
  ].join(' ');
}

/** Piece placement plus side to move: what daily targets are compared by (SPEC §2). */
export function targetKey(p: Position): string {
  const fen = toFen(p);
  return fen.slice(0, fen.indexOf(' ') + 2);
}

/** The standard starting position. */
export function initialPosition(): Position {
  const r = parseFen(START_FEN);
  if (!r.ok) throw new Error('START_FEN must parse');
  return r.value;
}
