// Records the README's demo GIFs into docs/demo/ against the e2e setup (fixture puzzles, a real
// API). Not a test suite: run with
//   pnpm --filter @retrograde/web gifs
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { GifRecorder } from './gif';
import { skipHowToPlay, solutionOf, submitGuess, today, typeMoves, wrongGuess } from './helpers';

const out = (name: string): string =>
  fileURLToPath(new URL(`../../../docs/demo/${name}`, import.meta.url));

test.use({ viewport: { width: 1200, height: 760 }, colorScheme: 'light' });

test('a daily solve', async ({ page, request }) => {
  test.setTimeout(120_000);
  const puzzle = await today(request);
  await skipHowToPlay(page);
  await page.goto('/daily');
  await expect(page.getByRole('heading', { level: 1, name: /Retrograde #/ })).toBeVisible();
  const gif = new GifRecorder(page);
  await gif.frame(2000);

  // A wrong first guess, move by move, and its feedback.
  for (const move of wrongGuess(puzzle.plies)) {
    await typeMoves(page, [move]);
    await gif.frame(350);
  }
  await submitGuess(page, 1);
  await gif.frame(2000);

  // A hint, then the right game.
  await page.getByRole('button', { name: /Take hint 1 of 3/ }).click();
  await gif.frame(1600);
  await page.getByRole('button', { name: 'Reset' }).click();
  for (const move of solutionOf(puzzle)) {
    await typeMoves(page, [move]);
    await gif.frame(350);
  }
  await submitGuess(page, 2);
  await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
  await gif.frame(2400);
  await page.getByRole('heading', { name: 'Share your result' }).scrollIntoViewIfNeeded();
  await gif.frame(3000);

  console.log(`daily.gif: ${String(Math.round(gif.save(out('daily.gif')) / 1024))} KB`);
});

test('the Lab', async ({ page }) => {
  test.setTimeout(120_000);
  const gif = new GifRecorder(page);

  // An impossible position: the verdict, then a detective note highlighting its squares.
  await page.goto(`/lab?fen=${encodeURIComponent('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1')}`);
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'illegal');
  await gif.frame(2400);
  await page.getByRole('button', { name: /could only have started/ }).hover();
  await expect(page.locator('cg-board square.note-highlight')).toHaveCount(3);
  await gif.frame(2400);

  // A strange but legal position: Prove it finds the shortest game, played back move by move.
  await page.goto(
    `/lab?fen=${encodeURIComponent('rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1')}`,
  );
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'undecided');
  await gif.frame(1800);
  await page.getByRole('button', { name: 'Prove it' }).click();
  await expect(page.getByText(/Found a shortest proof game: 12 plies/).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await gif.frame(1500);
  for (let ply = 1; ply <= 12; ply++) {
    await page.getByRole('button', { name: 'Next move', exact: true }).click();
    await gif.frame(ply === 12 ? 3000 : 550);
  }

  console.log(`lab.gif: ${String(Math.round(gif.save(out('lab.gif')) / 1024))} KB`);
});
