import { DOT, movesLabel, stars } from './format';

// The share card's symbols, exactly as in SPEC §8.3 and §8.6.
const SQUARES: Record<string, string> = {
  G: String.fromCodePoint(0x1f7e9), // 🟩
  Y: String.fromCodePoint(0x1f7e8), // 🟨
  X: String.fromCodePoint(0x2b1b), // ⬛
};
const LENS = String.fromCodePoint(0x1f50d); // 🔍
const NL = String.fromCharCode(10);

export interface ShareInput {
  number: number;
  difficulty: number;
  plies: number;
  status: 'solved' | 'failed';
  /** Each guess's feedback string ("GYX…"), in order. */
  feedback: readonly string[];
  hintsUsed: number;
  /** The site's origin, e.g. "https://retrograde.example". */
  origin: string;
  /** Archive (practice) play: marked as such and linked to that puzzle (DECISIONS 2026-10-29). */
  archive: boolean;
}

/** The text copied by "Share" (SPEC §8.6). It contains feedback only, never moves. */
export function shareText(s: ShareInput): string {
  const title = `Retrograde #${String(s.number)}${s.archive ? ' (practice)' : ''}`;
  const score = `${s.status === 'solved' ? String(s.feedback.length) : 'X'}/6`;
  const rows = s.feedback.map((f) => Array.from(f, (c) => SQUARES[c] ?? SQUARES.X).join(''));
  return [
    `${title} ${stars(s.difficulty)} ${DOT} ${movesLabel(s.plies)}`,
    s.hintsUsed > 0 ? `${score} ${DOT} ${LENS}${String(s.hintsUsed)}` : score,
    ...rows,
    `${s.origin}/daily${s.archive ? `/${String(s.number)}` : ''}`,
  ].join(NL);
}
