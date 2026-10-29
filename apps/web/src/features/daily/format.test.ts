import { describe, expect, it } from 'vitest';
import { describeDuration, formatDuration, lengthLabel, movesLabel, stars } from './format';

const STAR = String.fromCodePoint(0x2605);
const DOT = String.fromCodePoint(0x00b7);

describe('daily formats', () => {
  it('writes move counts the problemist way (SPEC §2)', () => {
    expect(movesLabel(9)).toBe('4.5 moves');
    expect(movesLabel(8)).toBe('4.0 moves');
    expect(movesLabel(1)).toBe('0.5 moves');
    expect(lengthLabel(9)).toBe(`4.5 moves ${DOT} 9 plies`);
    expect(lengthLabel(1)).toBe(`0.5 moves ${DOT} 1 ply`);
  });

  it('draws the difficulty as stars', () => {
    expect(stars(3)).toBe(STAR.repeat(3));
    expect(stars(0)).toBe('');
    expect(stars(9)).toBe(STAR.repeat(5));
  });

  it('shows solve times as m:ss, and h:mm:ss past an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(30 * 3600 + 61)).toBe('30:01:01');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('says durations in words for screen readers', () => {
    expect(describeDuration(3725)).toBe('1 hour 2 minutes 5 seconds');
    expect(describeDuration(60)).toBe('1 minute');
    expect(describeDuration(0)).toBe('0 seconds');
  });
});
