import { expect, test, type Page } from '@playwright/test';
import {
  released,
  registerVia,
  skipHowToPlay,
  submitGuess,
  typeMoves,
  uniqueName,
  wrongGuess,
} from './helpers';

// Sign in with Lichess against the fake lichess.org (scripts/fake-lichess.mjs on port 8093).
const FAKE_LICHESS = 'http://127.0.0.1:8093';

/** At the fake Lichess: type the username, then Authorize or Cancel. */
async function atLichess(page: Page, username: string, decision: 'Authorize' | 'Cancel') {
  await expect(page).toHaveURL(new RegExp(`^${FAKE_LICHESS}/oauth`));
  await expect(
    page.getByText(/wants to access your Lichess account \(public data only\)/),
  ).toBeVisible();
  await page.getByLabel('Lichess username').fill(username);
  await page.getByRole('button', { name: decision }).click();
}

async function liveTokens(page: Page): Promise<number> {
  const r = await page.request.get(`${FAKE_LICHESS}/_fake/state`);
  return ((await r.json()) as { live: number }).live;
}

test.describe('Sign in with Lichess', () => {
  test('a guest signs in with Lichess, keeps their guess, and gets a Lichess profile link', async ({
    page,
    request,
  }) => {
    const name = uniqueName('lc');
    const puzzle = await released(request, (p) => p.number === 2);
    await skipHowToPlay(page);
    await page.goto('/daily/2');
    await typeMoves(page, wrongGuess(puzzle.plies));
    await submitGuess(page, 1);

    await page.goto('/login?next=%2Fdaily%2F2');
    await page.getByRole('link', { name: 'Sign in with Lichess' }).click();
    await atLichess(page, name, 'Authorize');

    // Back where the player started, signed in, with their guess.
    await expect(page).toHaveURL(/\/daily\/2$/);
    const header = page.getByRole('banner').first();
    await expect(header.getByRole('link', { name })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Your guesses' }).getByRole('listitem'),
    ).toHaveCount(1);
    // The token was revoked straight away.
    expect(await liveTokens(page)).toBe(0);

    await header.getByRole('link', { name }).click();
    const link = page.getByRole('link', { name: new RegExp(`@${name}`) });
    await expect(link).toHaveAttribute('href', `https://lichess.org/@/${name.toLowerCase()}`);

    // Signing in again finds the same account.
    await header.getByRole('button', { name: 'Sign out' }).click();
    await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.goto('/login');
    await page.getByRole('link', { name: 'Sign in with Lichess' }).click();
    await atLichess(page, name, 'Authorize');
    await expect(header.getByRole('link', { name })).toBeVisible();
  });

  test('cancelling at Lichess comes back to the sign-in page with a message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Sign in with Lichess' }).click();
    await atLichess(page, uniqueName('nope'), 'Cancel');
    await expect(page).toHaveURL(/\/login\?lichess=cancelled$/);
    await expect(page.getByRole('alert')).toHaveText('Lichess sign-in was cancelled.');
  });

  test("a Lichess name matching someone's account never signs into that account", async ({
    page,
    browser,
  }) => {
    const name = uniqueName('same');
    // Someone registers the name with a password.
    const owner = await browser.newPage();
    await registerVia(owner, name);

    // A Lichess user with that name gets an account of their own.
    await page.goto('/login');
    await page.getByRole('link', { name: 'Sign in with Lichess' }).click();
    await atLichess(page, name, 'Authorize');
    const header = page.getByRole('banner').first();
    const own = header.getByRole('link', { name: /-2$/ });
    await expect(own).toBeVisible();
    await expect(header.getByRole('link', { name, exact: true })).toHaveCount(0);

    // The owner is still themselves.
    await owner.reload();
    await expect(
      owner.getByRole('banner').first().getByRole('link', { name, exact: true }),
    ).toBeVisible();
    await owner.close();
  });
});
