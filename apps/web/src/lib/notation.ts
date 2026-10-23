import { initialPosition, makeMove, moveToSan, toFen, uciToMove } from '@retrograde/engine';

const NAMES: Record<string, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

/** "White: king e1, queen d1, … Black: king e8, …": the board in words, for screen readers. */
export function describePlacement(placement: string): string {
  const white: string[] = [];
  const black: string[] = [];
  placement.split('/').forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const square = `${'abcdefgh'.charAt(file)}${String(8 - r)}`;
      const name = NAMES[ch.toLowerCase()] ?? ch;
      (ch === ch.toUpperCase() ? white : black).push(`${name} ${square}`);
      file++;
    }
  });
  const side = (label: string, list: string[]): string =>
    `${label}: ${list.length === 0 ? 'no pieces' : list.join(', ')}.`;
  return `${side('White', white)} ${side('Black', black)}`;
}

export interface ProofStep {
  /** SAN with move number, e.g. "1.e4" or "1…e5". */
  label: string;
  san: string;
  uci: string;
  /** FEN after this move. */
  fen: string;
}

/**
 * A proof game (UCI from the start) as SAN steps with the FEN after each move, for the proof
 * player. Cheap, so it runs on the main thread. Throws on an illegal move (proofs come from the
 * engine, so that would be a bug).
 */
export function proofSteps(ucis: readonly string[]): ProofStep[] {
  const p = initialPosition();
  return ucis.map((uci, i) => {
    const r = uciToMove(p, uci);
    if (!r.ok) throw new Error(`illegal proof move ${uci}: ${r.error}`);
    const san = moveToSan(p, r.value);
    makeMove(p, r.value);
    const number = Math.floor(i / 2) + 1;
    return {
      label: i % 2 === 0 ? `${String(number)}.${san}` : `${String(number)}…${san}`,
      san,
      uci,
      fen: toFen(p),
    };
  });
}

// Built from code points so the source has no invisible characters.
const ELLIPSIS = String.fromCharCode(0x2026); // "…"
const WORD_JOINER = String.fromCharCode(0x2060); // forbids a line break at its position
const ELLIPSIS_BEFORE_TEXT = new RegExp(ELLIPSIS + String.raw`(?=\S)`, 'g');

/** Keeps "…" attached to the move after it ("…Kh8-g8"), so a line never breaks between them. */
export function keepEllipsis(text: string): string {
  return text.replace(ELLIPSIS_BEFORE_TEXT, ELLIPSIS + WORD_JOINER);
}
