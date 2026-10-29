import { expect, test } from '@playwright/test';
import {
  registerVia,
  skipHowToPlay,
  solutionOf,
  submitGuess,
  today,
  typeMoves,
  uniqueName,
} from './helpers';

test.describe('accounts', () => {
  test('a guest who solves and then registers keeps the result, and the leaderboard shows them', async ({
    page,
    request,
  }) => {
    const puzzle = await today(request);
    const name = uniqueName('keeper');
    await skipHowToPlay(page);
    await page.goto('/daily');
    await typeMoves(page, solutionOf(puzzle));
    await submitGuess(page, 1);
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
    await expect(page.getByText(/playing as a guest/)).toBeVisible();

    // Create an account from the result screen; it comes back to the daily.
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/daily$/);
    const header = page.getByRole('banner').first();
    await expect(header.getByRole('link', { name })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
    await expect(page.getByText(/Current streak: 1 day/)).toBeVisible();
    await expect(page.getByText(/playing as a guest/)).toHaveCount(0);

    // The leaderboard lists them, marked as you.
    await page.getByRole('link', { name: "Today's leaderboard" }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('You')).toBeVisible();

    // And so does their profile.
    await header.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText('Solved', { exact: true }).locator('xpath=..')).toContainText('1');
    await expect(page.getByRole('row', { name: 'Solved in 1 guess 1' })).toBeAttached();
  });

  test('sign in, sign out, and the errors in between', async ({ page, browser }) => {
    const name = uniqueName('signer');
    await registerVia(page, name);
    // A taken name, in another browser.
    const other = await browser.newPage();
    await other.goto('/register');
    await other.getByLabel('Username').fill(name.toUpperCase());
    await other.getByLabel('Password').fill('another password');
    await other.getByRole('button', { name: 'Create account' }).click();
    await expect(other.getByRole('alert')).toContainText(/taken/i);

    // Signing out, then a wrong password, then the right one.
    const header = page.getByRole('banner').first();
    await header.getByRole('button', { name: 'Sign out' }).click();
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await header.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(header.getByRole('link', { name })).toBeVisible();
    await other.close();
  });
});
