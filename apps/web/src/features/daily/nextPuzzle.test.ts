import { describe, expect, it } from 'vitest';
import { formatRemaining, localTimeOf, nextPuzzleAfter, nextPuzzleAt } from './nextPuzzle';

describe('the countdown to the next puzzle', () => {
  it('counts to the next UTC midnight', () => {
    expect(nextPuzzleAt(new Date('2026-11-04T20:47:51Z')).toISOString()).toBe(
      '2026-11-05T00:00:00.000Z',
    );
    // Exactly at midnight, the next puzzle is a full day away.
    expect(nextPuzzleAt(new Date('2026-11-05T00:00:00Z')).toISOString()).toBe(
      '2026-11-06T00:00:00.000Z',
    );
    // Year end.
    expect(nextPuzzleAt(new Date('2026-12-31T23:59:59.500Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it("comes after the finished puzzle's own day, not the clock's", () => {
    // A daily finished after midnight: the next one is already out.
    expect(nextPuzzleAfter('2026-11-04').toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(nextPuzzleAfter('2026-12-31').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('shows the time left as h:mm:ss, rounded up to the second, never negative', () => {
    expect(formatRemaining(3 * 3600_000 + 12 * 60_000 + 9_000)).toBe('3:12:09');
    expect(formatRemaining(59_001)).toBe('0:01:00');
    expect(formatRemaining(500)).toBe('0:00:01');
    expect(formatRemaining(0)).toBe('0:00:00');
    expect(formatRemaining(-10)).toBe('0:00:00');
  });

  it("shows midnight UTC in the player's own time zone", () => {
    const midnight = new Date('2026-11-05T00:00:00Z');
    expect(localTimeOf(midnight, 'en-GB', 'Asia/Tokyo')).toBe('09:00');
    expect(localTimeOf(midnight, 'en-GB', 'America/New_York')).toBe('19:00');
    expect(localTimeOf(midnight, 'en-GB', 'UTC')).toBe('00:00');
  });
});
