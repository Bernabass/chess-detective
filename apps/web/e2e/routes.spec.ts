import { expect, test } from '@playwright/test';

const ROUTES: [string, RegExp][] = [
  ['/', /Don't ask for the best move/],
  ['/daily', /Daily proof game/],
  ['/daily/3', /Daily proof game #3/],
  ['/archive', /Archive/],
  ['/leaderboard', /Leaderboard/],
  ['/u/holmes', /holmes/],
  ['/login', /Sign in/],
  ['/register', /Create an account/],
  ['/about', /Thinking backwards/],
  ['/lab', /The Lab/],
  ['/nowhere', /This case file doesn't exist/],
];

test.describe('routes at 360 px', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  for (const [path, heading] of ROUTES) {
    test(`${path} renders with no horizontal scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    });
  }

  test('the mobile menu opens, navigates and closes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.locator('#mobile-nav').getByRole('link', { name: 'About' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Thinking backwards/ })).toBeVisible();
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
  });
});

test.describe('about page', () => {
  test('reveals the examples and plays the proof game', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Reveal the last move' }).click();
    await expect(page.getByText(/the last move was/)).toBeVisible();
    await page.getByRole('button', { name: 'Play the proof' }).click();
    const scrubber = page.getByRole('slider', { name: 'Proof game position' });
    await expect(scrubber).toHaveValue('6');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(scrubber).toHaveValue('0');
  });
});

test.describe('theme', () => {
  test('follows the system, and the toggle overrides it across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'System theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
