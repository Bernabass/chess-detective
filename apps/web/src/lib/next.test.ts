import { describe, expect, it } from 'vitest';
import { safeNext } from './next';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/daily/12')).toBe('/daily/12');
    expect(safeNext('/leaderboard?number=3')).toBe('/leaderboard?number=3');
  });

  it('refuses anything that could leave the site', () => {
    const backslash = String.fromCharCode(92);
    for (const bad of [
      null,
      '',
      'daily',
      'https://evil.example',
      '//evil.example',
      `/${backslash}evil.example`,
      'javascript:alert(1)',
      `/${String.fromCharCode(9)}/evil.example`,
      `/${String.fromCharCode(10)}/evil.example`,
    ]) {
      expect(safeNext(bad)).toBe('/daily');
    }
  });
});
