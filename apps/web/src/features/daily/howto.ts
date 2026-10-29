/**
 * The tiny example in How to play: a unique shortest proof game (1.e4 e5 2.Ke2 Ke7, checked by
 * howto.test.ts with the solver) and one guess with its feedback (the reference implementation's).
 */
export const HOW_TO_EXAMPLE = {
  solution: ['e2e4', 'e7e5', 'e1e2', 'e8e7'],
  /** 1.Nf3 e5 2.e4 Ke7. */
  guess: ['g1f3', 'e7e5', 'e2e4', 'e8e7'],
  feedback: 'XGYG',
  target: 'rnbq1bnr/ppppkppp/8/4p3/4P3/8/PPPPKPPP/RNBQ1BNR w',
} as const;

const SEEN_KEY = 'retrograde.howToPlay.seen';

/** Whether this browser has seen How to play (storage can be unavailable: then it hasn't). */
export function hasSeenHowToPlay(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHowToPlaySeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode or blocked storage: it shows again next time, which is harmless.
  }
}
