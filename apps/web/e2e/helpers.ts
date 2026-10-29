// Helpers for the tests that use the e2e API (scripts/e2e-api.mjs: fixture puzzles in a fresh
// "e2e" schema, today = #4, #1-#3 in the archive).
import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

interface FixturePuzzle {
  target: string;
  plies: number;
  solution: string[];
}

const fixture: FixturePuzzle[] = readFileSync(
  new URL('./fixtures/puzzles.jsonl', import.meta.url),
  'utf8',
)
  .split(String.fromCharCode(10))
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as FixturePuzzle);

export interface ServedPuzzle {
  number: number;
  plies: number;
  target: string;
  day: string;
}

/** The known solution of a served puzzle (the tests know the fixture; players never see it). */
export function solutionOf(p: ServedPuzzle): string[] {
  const found = fixture.find((f) => f.target === p.target && f.plies === p.plies);
  if (found === undefined) throw new Error(`puzzle #${String(p.number)} is not from the fixture`);
  return found.solution;
}

export async function today(request: APIRequestContext): Promise<ServedPuzzle> {
  const r = await request.get('/api/daily');
  expect(r.ok()).toBe(true);
  return (await r.json()) as ServedPuzzle;
}

/** A released puzzle (today's or an archive one) matching a condition. */
export async function released(
  request: APIRequestContext,
  ok: (p: ServedPuzzle) => boolean,
): Promise<ServedPuzzle> {
  const r = await request.get('/api/archive');
  const { puzzles } = (await r.json()) as { puzzles: Omit<ServedPuzzle, 'target'>[] };
  for (const item of puzzles) {
    const p = (await (
      await request.get(`/api/daily/${String(item.number)}`)
    ).json()) as ServedPuzzle;
    if (ok(p)) return p;
  }
  throw new Error('no released puzzle matches');
}

// Knights out and back, six different ways (the page refuses a guess it has already seen).
const CYCLES = [
  ['b1a3', 'b8a6', 'a3b1', 'a6b8'],
  ['b1c3', 'b8c6', 'c3b1', 'c6b8'],
  ['g1h3', 'g8h6', 'h3g1', 'h6g8'],
  ['g1f3', 'g8f6', 'f3g1', 'f6g8'],
  ['b1a3', 'g8h6', 'a3b1', 'h6g8'],
  ['g1h3', 'b8a6', 'h3g1', 'a6b8'],
];

/**
 * A legal game of n plies that's almost surely wrong: knights out and back (variant 0-5), ending
 * with d2-d3 when n is odd (no knight in these cycles ever stands on d3).
 */
export function wrongGuess(n: number, variant = 0): string[] {
  const cycle = CYCLES[variant % CYCLES.length] ?? CYCLES[0] ?? [];
  const out: string[] = [];
  while (out.length < (n % 2 === 0 ? n : n - 1)) out.push(cycle[out.length % 4] ?? 'b1a3');
  if (out.length < n) out.push('d2d3');
  return out;
}

let counter = 0;
/** A username no other test (or run) uses: 3-20 of [A-Za-z0-9_-]. */
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36).slice(-6)}${String(counter)}`.slice(0, 20);
}

/** Opens a page without the first-visit How to play dialog. */
export async function skipHowToPlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('retrograde.howToPlay.seen', '1');
  });
}

/** Plays moves with the typed-move field (UCI or SAN), pressing Enter after each. */
export async function typeMoves(page: Page, moves: readonly string[]): Promise<void> {
  const input = page.getByPlaceholder(/Type a move/);
  for (const m of moves) {
    await input.fill(m);
    await input.press('Enter');
  }
}

/** Drags a piece on the play board from one square to another (white at the bottom). */
export async function drag(page: Page, from: string, to: string): Promise<void> {
  const board = page.getByRole('img', { name: /^Your game/ });
  // The whole board must be on screen: a drag that starts below the fold hits nothing.
  await board.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  const box = await board.boundingBox();
  if (box === null) throw new Error('no board');
  const centre = (sq: string): [number, number] => {
    const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = Number(sq.charAt(1));
    return [box.x + ((file + 0.5) * box.width) / 8, box.y + ((8 - rank + 0.5) * box.height) / 8];
  };
  const [fx, fy] = centre(from);
  const [tx, ty] = centre(to);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
}

/** Submits the guess on the board and waits for its row. */
export async function submitGuess(page: Page, guessNumber: number): Promise<void> {
  await page.getByRole('button', { name: 'Submit guess' }).click();
  await expect(page.getByRole('list', { name: 'Your guesses' }).getByRole('listitem')).toHaveCount(
    guessNumber,
  );
}

/** Registers an account from the current page's context (a guest's progress moves to it). */
export async function registerVia(page: Page, username: string): Promise<void> {
  // Back to /about afterwards (the default, /daily, opens How to play for a new browser).
  await page.goto('/register?next=%2Fabout');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('banner').first().getByRole('link', { name: username }),
  ).toBeVisible();
}
