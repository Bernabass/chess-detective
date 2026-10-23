import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'about', path: '/about' },
  { name: 'login', path: '/login' },
  // The Lab with a full report showing (verdict, notes, last moves).
  { name: 'lab', path: `/lab?fen=${encodeURIComponent('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1')}` },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    for (const p of PAGES) {
      test(`${p.name} has no serious or critical axe violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(p.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (p.name === 'lab') await expect(page.locator('[data-verdict]')).toBeVisible();
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
