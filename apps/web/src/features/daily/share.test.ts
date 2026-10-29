import { describe, expect, it } from 'vitest';
import { shareText } from './share';

const G = String.fromCodePoint(0x1f7e9); // 🟩
const Y = String.fromCodePoint(0x1f7e8); // 🟨
const X = String.fromCodePoint(0x2b1b); // ⬛
const LENS = String.fromCodePoint(0x1f50d); // 🔍
const STAR = String.fromCodePoint(0x2605);
const DOT = String.fromCodePoint(0x00b7);
const NL = String.fromCharCode(10);

describe('shareText (SPEC §8.6)', () => {
  it("matches the spec's example exactly", () => {
    const text = shareText({
      number: 142,
      difficulty: 3,
      plies: 9,
      status: 'solved',
      feedback: ['YGXGXXGGY', 'GGYGGXGGG', 'GGGGGGGGG'],
      hintsUsed: 1,
      origin: 'https://retrograde.example',
      archive: false,
    });
    expect(text).toBe(
      [
        `Retrograde #142 ${STAR.repeat(3)} ${DOT} 4.5 moves`,
        `3/6 ${DOT} ${LENS}1`,
        `${Y}${G}${X}${G}${X}${X}${G}${G}${Y}`,
        `${G}${G}${Y}${G}${G}${X}${G}${G}${G}`,
        G.repeat(9),
        'https://retrograde.example/daily',
      ].join(NL),
    );
  });

  it('shows X/6 for a failed attempt and omits the lens without hints', () => {
    const text = shareText({
      number: 7,
      difficulty: 1,
      plies: 4,
      status: 'failed',
      feedback: Array.from({ length: 6 }, () => 'XXXX'),
      hintsUsed: 0,
      origin: 'http://localhost:5173',
      archive: false,
    });
    const lines = text.split(NL);
    expect(lines[0]).toBe(`Retrograde #7 ${STAR} ${DOT} 2.0 moves`);
    expect(lines[1]).toBe('X/6');
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe('http://localhost:5173/daily');
    expect(text).not.toContain(LENS);
  });

  it('marks archive play as practice and links to that puzzle', () => {
    const text = shareText({
      number: 12,
      difficulty: 2,
      plies: 7,
      status: 'solved',
      feedback: ['GGGGGGG'],
      hintsUsed: 2,
      origin: 'https://retrograde.example',
      archive: true,
    });
    const lines = text.split(NL);
    expect(lines[0]).toBe(`Retrograde #12 (practice) ${STAR.repeat(2)} ${DOT} 3.5 moves`);
    expect(lines[1]).toBe(`1/6 ${DOT} ${LENS}2`);
    expect(lines.at(-1)).toBe('https://retrograde.example/daily/12');
  });
});
