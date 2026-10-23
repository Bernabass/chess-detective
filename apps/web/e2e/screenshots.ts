// Screenshots for the visual review (Phase 5 plan): every key page at 360 and 1280 px wide, in
// light and dark mode, written to apps/web/screenshots/ (gitignored). Not a test suite: run with
//   pnpm --filter @retrograde/web shots
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [
  { name: '360', width: 360, height: 800 },
  { name: '1280', width: 1280, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

const lab = (fen: string): string => `/lab?fen=${encodeURIComponent(fen)}`;

interface Shot {
  name: string;
  path: string;
  /** Extra steps after load (open a reveal, start Prove, hover a note...). */
  prepare?: (page: Page) => Promise<void>;
}

const waitForVerdict = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-verdict]')).toBeVisible({ timeout: 15_000 });
};

const SHOTS: Shot[] = [
  { name: 'home', path: '/' },
  { name: 'about', path: '/about' },
  {
    name: 'about-revealed',
    path: '/about',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Play the proof' }).click();
      await page.getByRole('button', { name: 'Reveal the last move' }).click();
    },
  },
  { name: 'daily', path: '/daily' },
  { name: 'login', path: '/login' },
  { name: 'not-found', path: '/no-such-page' },
  { name: 'lab-start', path: '/lab', prepare: waitForVerdict },
  {
    name: 'lab-illegal-note',
    path: lab('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1'),
    prepare: async (page) => {
      await waitForVerdict(page);
      await page
        .getByRole('button', { name: /could only have started/ })
        .first()
        .click();
    },
  },
  {
    name: 'lab-proof',
    path: lab('r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 0 1'),
    prepare: async (page) => {
      await waitForVerdict(page);
      await page.getByRole('button', { name: /^3\./ }).first().click();
    },
  },
  {
    name: 'lab-proved',
    path: lab('rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1'),
    prepare: async (page) => {
      await waitForVerdict(page);
      await page.getByRole('button', { name: 'Prove it' }).click();
      await expect(page.getByText(/Found a shortest proof game/).first()).toBeVisible({
        timeout: 30_000,
      });
    },
  },
  {
    name: 'lab-armed',
    path: '/lab',
    prepare: async (page) => {
      await waitForVerdict(page);
      await page.getByRole('button', { name: 'Place white knight' }).click();
    },
  },
];

for (const w of WIDTHS) {
  for (const scheme of SCHEMES) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${w.name} ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: w.width, height: w.height });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(shot.path);
        await page.waitForLoadState('networkidle');
        await shot.prepare?.(page);
        await page.waitForTimeout(400); // let board animations settle
        await page.screenshot({
          path: `screenshots/${shot.name}-${w.name}-${scheme}.png`,
          fullPage: true,
        });
      });
    }
  }
}
