import { expect, test } from '@playwright/test';
import {
  registerVia,
  released,
  skipHowToPlay,
  solutionOf,
  submitGuess,
  today,
  typeMoves,
  uniqueName,
  wrongGuess,
} from './helpers';

test.describe('archive, leaderboards and profiles', () => {
  test('the archive lists past puzzles with your results and opens them', async ({
    page,
    request,
  }) => {
    const puzzle = await released(request, (p) => p.number === 3);
    await skipHowToPlay(page);
    await page.goto('/daily/3');
    await typeMoves(page, wrongGuess(puzzle.plies));
    await submitGuess(page, 1);
    await page.getByRole('button', { name: 'Reset' }).click();
    await typeMoves(page, solutionOf(puzzle));
    await submitGuess(page, 2);

    await page.goto('/archive');
    const list = page.getByRole('list', { name: 'Past puzzles' });
    // Today's puzzle back to #1.
    await expect(list.getByRole('link')).toHaveCount((await today(request)).number);
    const three = list.getByRole('link', { name: /#3/ });
    await expect(three).toContainText('Solved 2/6');
    await expect(list.getByRole('link', { name: /#2/ })).toContainText('Not played');
    await three.click();
    await expect(page).toHaveURL(/\/daily\/3$/);
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
  });

  test('the all-time board ranks accounts, and profiles show their stats', async ({
    page,
    request,
  }) => {
    const name = uniqueName('ranker');
    await registerVia(page, name);
    const puzzle = await released(request, (p) => p.day === new Date().toISOString().slice(0, 10));
    await skipHowToPlay(page);
    await page.goto('/daily');
    await typeMoves(page, solutionOf(puzzle));
    await submitGuess(page, 1);

    await page.goto('/leaderboard?view=all-time&metric=solved');
    await expect(page.getByRole('button', { name: 'Solved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(name) })).toBeVisible();
    await expect(page.getByTestId('distribution')).toBeVisible();

    await page.goto('/u/nobody_here');
    await expect(page.getByText('No detective by that name.')).toBeVisible();
  });
});
