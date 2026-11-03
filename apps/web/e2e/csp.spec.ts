// The app works under the production Content-Security-Policy, which `vite preview` sends from
// vercel.json: the theme script, styles, fonts, piece images, the engine workers and API calls
// all load without a single violation.
import { expect, test } from '@playwright/test';
import { drag, skipHowToPlay, today, typeMoves, wrongGuess } from './helpers';

test('the production CSP is sent and nothing violates it', async ({ page, request }) => {
  test.setTimeout(90_000);
  // Chromium reports every violation (pages and workers) as a console error.
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text()))
      violations.push(msg.text());
  });

  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");

  // The Lab: analysis runs in one engine worker, a proof in another.
  await page.goto(
    `/lab?fen=${encodeURIComponent('rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1')}`,
  );
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'undecided');
  await page.getByRole('button', { name: 'Prove it' }).click();
  await expect(page.getByText(/Found a shortest proof game: 12 plies/).first()).toBeVisible({
    timeout: 30_000,
  });

  // The daily board: drag a piece, type the rest, submit a guess.
  const puzzle = await today(request);
  await skipHowToPlay(page);
  await page.goto('/daily');
  const wrong = wrongGuess(puzzle.plies);
  await drag(page, 'b1', 'a3');
  await typeMoves(page, wrong.slice(1));
  await page.getByRole('button', { name: 'Submit guess' }).click();
  await expect(page.getByRole('list', { name: 'Your guesses' }).getByRole('listitem')).toHaveCount(
    1,
  );

  for (const path of ['/about', '/leaderboard', '/archive', '/privacy', '/login', '/register']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(violations).toEqual([]);
});
