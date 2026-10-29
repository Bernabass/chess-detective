// Screenshots for the visual review (Phase 5 plan): every key page at 360 and 1280 px wide, in
// light and dark mode, written to apps/web/screenshots/ (gitignored). Not a test suite: run with
//   pnpm --filter @retrograde/web shots
import { initialPosition, legalMoves, makeMove, moveToUci, uciToMove } from '@retrograde/engine';
import { expect, request as apiRequest, test, type Page } from '@playwright/test';
import {
  drag,
  released,
  skipHowToPlay,
  solutionOf,
  submitGuess,
  today,
  typeMoves,
  wrongGuess,
} from './helpers';

const WIDTHS = [
  { name: '360', width: 360, height: 800 },
  { name: '1280', width: 1280, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

// "Copy result" shows its copied state.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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
  ...dailyShots(),
];

/** The solution with its last ply changed to another legal move: all green but one. */
function nearlyRight(solution: readonly string[]): string[] {
  const p = initialPosition();
  for (const uci of solution.slice(0, -1)) {
    const r = uciToMove(p, uci);
    if (!r.ok) throw new Error(r.error);
    makeMove(p, r.value);
  }
  const last = solution.at(-1);
  const other = legalMoves(p)
    .map(moveToUci)
    .find((m) => m !== last);
  if (other === undefined) throw new Error('no other move');
  return [...solution.slice(0, -1), other];
}

const PASSWORD = 'a long password';

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Signed in when it leaves /login (on a phone the username is inside the menu).
  await expect(page).not.toHaveURL(/\/login/);
}

function dailyShots(): Shot[] {
  return [
    { name: 'daily-howto', path: '/daily' },
    {
      name: 'daily-progress',
      path: '/daily',
      prepare: async (page) => {
        const puzzle = await today(page.request);
        await typeMoves(page, wrongGuess(puzzle.plies));
        await submitGuess(page, 1);
        await page.getByRole('button', { name: 'Reset' }).click();
        await typeMoves(page, nearlyRight(solutionOf(puzzle)));
        await submitGuess(page, 2);
        await page.getByRole('button', { name: /Take hint 1 of 3/ }).click();
        await expect(page.getByTestId('hint-1')).toBeVisible();
        await page.getByRole('button', { name: 'Reset' }).click();
        await typeMoves(page, solutionOf(puzzle).slice(0, 3));
        await page.getByLabel('Show differences from the target').check();
      },
    },
    {
      name: 'daily-promotion',
      path: '/',
      prepare: async (page) => {
        const puzzle = await released(page.request, (p) => p.plies >= 9);
        await page.goto(`/daily/${String(puzzle.number)}`);
        await typeMoves(page, ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6']);
        await drag(page, 'b7', 'a8');
        await expect(page.getByRole('dialog', { name: 'Promote to' })).toBeVisible();
      },
    },
    {
      name: 'daily-won',
      path: '/daily',
      prepare: async (page) => {
        const puzzle = await today(page.request);
        await typeMoves(page, nearlyRight(solutionOf(puzzle)));
        await submitGuess(page, 1);
        await page.getByRole('button', { name: /Take hint 1 of 3/ }).click();
        await page.getByRole('button', { name: 'Reset' }).click();
        await typeMoves(page, solutionOf(puzzle));
        await submitGuess(page, 2);
        await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
        await page.getByRole('button', { name: 'Copy result' }).click();
      },
    },
    {
      name: 'daily-lost',
      path: '/',
      prepare: async (page) => {
        const puzzle = await released(page.request, (p) => p.number === 1);
        await page.goto('/daily/1');
        for (let i = 1; i <= 6; i++) {
          await typeMoves(
            page,
            i === 6 ? nearlyRight(solutionOf(puzzle)) : wrongGuess(puzzle.plies, i - 1),
          );
          await submitGuess(page, i);
          if (i < 6) await page.getByRole('button', { name: 'Reset' }).click();
        }
        await expect(page.getByRole('heading', { name: 'Case unsolved' })).toBeVisible();
      },
    },
    {
      name: 'leaderboard',
      path: '/',
      prepare: async (page) => {
        await signIn(page, 'mycroft');
        await page.goto('/leaderboard');
        await expect(page.getByRole('table')).toBeVisible();
      },
    },
    {
      name: 'leaderboard-alltime',
      path: '/leaderboard?view=all-time&metric=solved',
      prepare: async (page) => {
        await expect(page.getByRole('table')).toBeVisible();
      },
    },
    {
      name: 'profile',
      path: '/u/mycroft',
      prepare: async (page) => {
        await expect(page.getByTestId('distribution')).toBeVisible();
      },
    },
    {
      name: 'archive',
      path: '/',
      prepare: async (page) => {
        const three = await released(page.request, (p) => p.number === 3);
        await page.goto('/daily/3');
        await typeMoves(page, solutionOf(three));
        await submitGuess(page, 1);
        const two = await released(page.request, (p) => p.number === 2);
        await page.goto('/daily/2');
        await typeMoves(page, wrongGuess(two.plies));
        await submitGuess(page, 1);
        await page.goto('/archive');
        await expect(page.getByRole('list', { name: 'Past puzzles' })).toBeVisible();
      },
    },
    {
      name: 'login-error',
      path: '/login',
      prepare: async (page) => {
        await page.getByLabel('Username').fill('mycroft');
        await page.getByLabel('Password').fill('not the password');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('alert')).toBeVisible();
      },
    },
    { name: 'register', path: '/register' },
  ];
}

/**
 * Accounts with results on today's puzzle, so the leaderboards and a profile have something to
 * show. Both workers run this; the second one finds the names taken and skips them.
 */
test.beforeAll(async () => {
  const players: { name: string; wrong: number; hints: number }[] = [
    { name: 'irene_adler', wrong: 0, hints: 0 },
    { name: 'mycroft', wrong: 1, hints: 1 },
    { name: 'lestrade', wrong: 2, hints: 2 },
    { name: 'mrs_hudson', wrong: 6, hints: 0 },
  ];
  for (const p of players) {
    const api = await apiRequest.newContext({
      baseURL: 'http://127.0.0.1:4173',
      extraHTTPHeaders: { Origin: 'http://127.0.0.1:4173' },
    });
    const reg = await api.post('/api/auth/register', {
      data: { username: p.name, password: PASSWORD },
    });
    if (reg.status() === 201) {
      const puzzle = await today(api);
      const solution = solutionOf(puzzle);
      const base = `/api/daily/${String(puzzle.number)}`;
      await api.post(`${base}/start`, { data: {} });
      for (let i = 0; i < p.hints; i++) await api.post(`${base}/hints`, { data: {} });
      for (let i = 0; i < p.wrong; i++) {
        await api.post(`${base}/guesses`, {
          data: { moves: i % 2 === 0 ? wrongGuess(puzzle.plies) : nearlyRight(solution) },
        });
      }
      if (p.wrong < 6) await api.post(`${base}/guesses`, { data: { moves: solution } });
    }
    await api.dispose();
  }
});

for (const w of WIDTHS) {
  for (const scheme of SCHEMES) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${w.name} ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: w.width, height: w.height });
        await page.emulateMedia({ colorScheme: scheme });
        if (shot.name !== 'daily-howto') await skipHowToPlay(page);
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
