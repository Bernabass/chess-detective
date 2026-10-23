import { parseFen, START_FEN } from '@retrograde/engine';

/** The Lab's position, as the six FEN fields. */
export interface LabFields {
  placement: string;
  side: 'w' | 'b';
  /** Subset of "KQkq" in that order, or "" for none. */
  castling: string;
  /** En passant square like "e3", or "" for none. */
  enPassant: string;
}

export const START: LabFields = fromFen(START_FEN) ?? {
  placement: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
  side: 'w',
  castling: 'KQkq',
  enPassant: '',
};

export const EMPTY: LabFields = {
  placement: '8/8/8/8/8/8/8/8',
  side: 'w',
  castling: '',
  enPassant: '',
};

/** The FEN for the fields (clocks are always "0 1": retro analysis ignores them). */
export function toFenString(f: LabFields): string {
  return `${f.placement} ${f.side} ${f.castling === '' ? '-' : f.castling} ${f.enPassant === '' ? '-' : f.enPassant} 0 1`;
}

/**
 * Fields from a pasted FEN, forgiving missing trailing fields ("placement w" or just the
 * placement): they default to White to move, no castling, no en passant. Null if the FEN is
 * invalid; parseError() says why.
 */
export function fromFen(text: string): LabFields | null {
  const fen = normalizeFen(text);
  if (fen === null || !parseFen(fen).ok) return null;
  const [placement = '', side = 'w', castling = '-', enPassant = '-'] = fen.split(' ');
  return {
    placement,
    side: side === 'b' ? 'b' : 'w',
    castling: castling === '-' ? '' : castling,
    enPassant: enPassant === '-' ? '' : enPassant,
  };
}

function normalizeFen(text: string): string | null {
  const fields = text
    .trim()
    .split(/\s+/)
    .filter((s) => s !== '');
  if (fields.length === 0 || fields.length > 6) return null;
  const defaults = ['', 'w', '-', '-', '0', '1'];
  return defaults.map((d, i) => fields[i] ?? d).join(' ');
}

/** Why a pasted FEN is invalid (the engine's own messages), or null if it's fine. */
export function parseError(text: string): string | null {
  const fen = normalizeFen(text);
  if (fen === null)
    return 'A FEN has 1 to 6 fields separated by spaces; this one has none or too many.';
  const r = parseFen(fen);
  return r.ok ? null : r.error.map((e) => e.message).join(' ');
}

/** The Lab URL for a position: /lab?fen=… (SPEC §9.3). */
export function labPath(f: LabFields): string {
  return `/lab?fen=${encodeURIComponent(toFenString(f))}`;
}

/** Lichess's board editor with this position (spaces become underscores in its URL). */
export function lichessEditorUrl(f: LabFields): string {
  return `https://lichess.org/editor/${toFenString(f).replaceAll(' ', '_')}`;
}

/** Castling rights in canonical order, keeping only K, Q, k, q. */
export function normalizeCastling(rights: string): string {
  return ['K', 'Q', 'k', 'q'].filter((c) => rights.includes(c)).join('');
}
