import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  registerVia,
  skipHowToPlay,
  solutionOf,
  submitGuess,
  today,
  typeMoves,
  uniqueName,
  wrongGuess,
} from './helpers';

interface Scan {
  name: string;
  path: string;
  /** Gets the page into the state to scan (after any setup, before path is opened). */
  prepare?: (page: Page, request: APIRequestContext) => Promise<void>;
  /** Steps after the page opened. */
  then?: (page: Page, request: APIRequestContext) => Promise<void>;
}

const PAGES: Scan[] = [
  { name: 'home', path: '/' },
  { name: 'about', path: '/about' },
  { name: 'login', path: '/login' },
  { name: 'login after a failed Lichess sign-in', path: '/login?lichess=failed' },
  // The Lab with a full report showing (verdict, notes, last moves).
  { name: 'lab', path: `/lab?fen=${encodeURIComponent('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1')}` },
  {
    name: 'daily How to play',
    path: '/daily',
    then: async (page) => {
      await expect(page.getByRole('dialog', { name: 'How to play' })).toBeVisible();
    },
  },
  {
    name: 'daily in progress',
    path: '/daily',
    prepare: skipHowToPlay,
    then: async (page, request) => {
      const puzzle = await today(request);
      await typeMoves(page, wrongGuess(puzzle.plies));
      await submitGuess(page, 1);
      await page.getByRole('button', { name: /Take hint 1 of 3/ }).click();
      await expect(page.getByTestId('hint-1')).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await typeMoves(page, ['Qh9']); // shows the typed-move error
      await page.getByLabel('Show differences from the target').check();
    },
  },
  {
    name: 'daily won',
    path: '/daily',
    prepare: skipHowToPlay,
    then: async (page, request) => {
      await typeMoves(page, solutionOf(await today(request)));
      await submitGuess(page, 1);
      await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
    },
  },
  {
    name: 'register with an error',
    path: '/',
    then: async (page) => {
      // Register a name, sign out, and try to register it again: the "taken" alert.
      const name = uniqueName('taken');
      await registerVia(page, name);
      await page.getByRole('banner').first().getByRole('button', { name: 'Sign out' }).click();
      await page.goto('/register');
      await page.getByLabel('Username').fill(name);
      await page.getByLabel('Password').fill('long enough please');
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('alert')).toContainText('taken');
    },
  },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'leaderboard all-time', path: '/leaderboard?view=all-time&metric=solved' },
  { name: 'archive', path: '/archive' },
  {
    name: 'profile',
    path: '/',
    then: async (page) => {
      const name = uniqueName('axe');
      await registerVia(page, name);
      await page.goto(`/u/${name}`);
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(name) })).toBeVisible();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    for (const p of PAGES) {
      test(`${p.name} has no serious or critical axe violations`, async ({ page, request }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await p.prepare?.(page, request);
        await page.goto(p.path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        if (p.name === 'lab') await expect(page.locator('[data-verdict]')).toBeVisible();
        await p.then?.(page, request);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        const serious = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          serious.map(
            (v) =>
              `${v.id}: ${v.help} (${v.nodes
                .map((n) => n.target.join(' '))
                .slice(0, 3)
                .join(', ')})`,
          ),
        ).toEqual([]);
      });
    }
  });
}

test('the Lab can be used with the keyboard alone', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'legal');
  // Skip link first, then on into the page.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Type a position into the FEN field without touching the mouse.
  const fen = page.getByLabel('FEN', { exact: true });
  for (let i = 0; i < 60 && !(await fen.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(fen).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('k7/8/8/8/8/PP6/PP6/K7 w');
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'illegal');

  // Place a piece with click-to-place, by keyboard.
  const knight = page.getByRole('button', { name: 'Place white knight' });
  await knight.focus();
  await page.keyboard.press('Enter');
  const e4 = page.getByRole('button', { name: 'Place white knight on e4' });
  await e4.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(fen).toHaveValue(/4N3/);

  // A detective note reacts to focus: it highlights its squares. (Wait for the new analysis: the
  // report is inert while it runs.)
  await expect(page.locator('[inert]')).toHaveCount(0);
  await page.getByRole('button', { name: /could only have started/ }).focus();
  await expect(page.locator('cg-board square.note-highlight')).toHaveCount(3);
});
