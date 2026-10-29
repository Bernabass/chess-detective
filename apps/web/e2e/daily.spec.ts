import { expect, test } from '@playwright/test';
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

const LENS = String.fromCodePoint(0x1f50d);
const DOT = String.fromCodePoint(0x00b7);

test.describe('the daily game', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a guest solves the seeded daily with the known solution', async ({ page, request }) => {
    const puzzle = await today(request);
    const solution = solutionOf(puzzle);
    await skipHowToPlay(page);
    await page.goto('/daily');
    await expect(
      page.getByRole('heading', { level: 1, name: `Retrograde #${String(puzzle.number)}` }),
    ).toBeVisible();
    await expect(page.getByTestId('ply-counter')).toHaveText(`0 / ${String(puzzle.plies)}`);

    // A wrong guess: the first move by dragging on the board, the rest typed.
    const wrong = wrongGuess(puzzle.plies);
    await drag(page, 'b1', 'a3');
    await expect(page.getByTestId('ply-counter')).toHaveText(`1 / ${String(puzzle.plies)}`);
    const submit = page.getByRole('button', { name: 'Submit guess' });
    await typeMoves(page, wrong.slice(1, -1));
    await expect(submit).toBeDisabled();
    await page.getByLabel('Show differences from the target').check();
    await expect(page.locator('cg-board square.diff-mark').first()).toBeVisible();
    await typeMoves(page, wrong.slice(-1));
    await expect(submit).toBeEnabled();
    await submitGuess(page, 1);
    // Every ply gets a square with an icon, and the result is announced.
    const row = page.getByRole('list', { name: 'Your guesses' }).getByRole('listitem').first();
    await expect(row.locator('[data-feedback]')).toHaveCount(puzzle.plies);
    await expect(row.locator('[data-feedback] svg')).toHaveCount(puzzle.plies);
    await expect(page.locator('[aria-live="polite"].sr-only')).toContainText('Guess 1 of 6:');

    // A hint.
    await page.getByRole('button', { name: /Take hint 1 of 3/ }).click();
    await expect(page.getByTestId('hint-1')).toContainText('White moved:');

    // The solution.
    await page.getByRole('button', { name: 'Reset' }).click();
    await typeMoves(page, solution);
    await submitGuess(page, 2);
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
    await expect(page.getByText(/Solved in 2\/6 with 1 hint/)).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Proof game moves' }).getByRole('listitem'),
    ).toHaveCount(puzzle.plies);

    // The share card, copied (SPEC §8.6).
    await page.getByRole('button', { name: 'Copy result' }).click();
    await expect(page.getByText('Copied. Paste it anywhere.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // The Windows clipboard turns line feeds into CRLF.
    const lines = copied
      .split(String.fromCharCode(10))
      .map((line) => line.replace(new RegExp(String.fromCharCode(13) + '$'), ''));
    expect(lines[0]).toMatch(
      new RegExp(`^Retrograde #${String(puzzle.number)} \u2605+ ${DOT} \\d\\.\\d moves$`),
    );
    expect(lines[1]).toBe(`2/6 ${DOT} ${LENS}1`);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('http://127.0.0.1:4173/daily');

    // What's next: the countdown, in local time.
    await expect(page.getByText(/Next puzzle in/)).toBeVisible();
    await expect(page.getByRole('timer')).toHaveText(/^\d{1,2}:\d\d:\d\d$/);
    await expect(page.getByText(/your time/)).toBeVisible();

    // A reload shows the same finished attempt.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
  });

  test('six wrong guesses on an archive puzzle reveal the solution, as practice', async ({
    page,
    request,
  }) => {
    const puzzle = await released(request, (p) => p.number === 1);
    await skipHowToPlay(page);
    await page.goto('/daily/1');
    await expect(page.getByText(/Practice: an archive puzzle/)).toBeVisible();
    for (let i = 1; i <= 6; i++) {
      await typeMoves(page, wrongGuess(puzzle.plies, i - 1));
      await submitGuess(page, i);
      if (i < 6) await page.getByRole('button', { name: 'Reset' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Case unsolved' })).toBeVisible();
    await expect(page.getByTestId('share-text')).toContainText('(practice)');
    await expect(page.getByTestId('share-text')).toContainText('X/6');
    await expect(page.getByTestId('share-text')).toContainText('/daily/1');
    await expect(
      page.getByRole('list', { name: 'Proof game moves' }).getByRole('listitem'),
    ).toHaveCount(puzzle.plies);
    await expect(page.getByRole('timer')).toHaveCount(0);
  });

  test('promotions open a picker, and Escape takes the move back', async ({ page, request }) => {
    const puzzle = await released(request, (p) => p.plies >= 9);
    await skipHowToPlay(page);
    await page.goto(`/daily/${String(puzzle.number)}`);
    await typeMoves(page, ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6']);
    await drag(page, 'b7', 'a8');
    const picker = page.getByRole('dialog', { name: 'Promote to' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'queen' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId('ply-counter')).toHaveText(`8 / ${String(puzzle.plies)}`);

    await drag(page, 'b7', 'a8');
    await page
      .getByRole('dialog', { name: 'Promote to' })
      .getByRole('button', { name: 'knight' })
      .click();
    await expect(page.getByRole('list', { name: 'Your moves' })).toContainText('5.bxa8=N');
    // Typed promotions work too.
    await page.getByRole('button', { name: 'Undo' }).click();
    await typeMoves(page, ['bxa8=Q']);
    await expect(page.getByRole('list', { name: 'Your moves' })).toContainText('5.bxa8=Q');
  });

  test('How to play shows on the first visit only, and reopens', async ({ page }) => {
    await page.goto('/daily');
    const dialog = page.getByRole('dialog', { name: 'How to play' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Ply 3, e4: right move, another ply/)).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'How to play' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start playing' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a puzzle can be solved with the keyboard alone', async ({ page, request }) => {
    const puzzle = await released(request, (p) => p.number === 2);
    const solution = solutionOf(puzzle);
    await skipHowToPlay(page);
    await page.goto('/daily/2');
    const input = page.getByPlaceholder(/Type a move/);
    await expect(input).toBeEnabled();
    for (let i = 0; i < 80 && !(await input.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(input).toBeFocused();
    for (const m of solution) {
      await page.keyboard.type(m);
      await page.keyboard.press('Enter');
    }
    const submit = page.getByRole('button', { name: 'Submit guess' });
    for (
      let i = 0;
      i < 20 && !(await submit.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Case closed' })).toBeVisible();
  });

  test("an unreleased puzzle can't be opened", async ({ page, request }) => {
    const next = (await today(request)).number + 1;
    await skipHowToPlay(page);
    await page.goto(`/daily/${String(next)}`);
    await expect(page.getByText(`Puzzle #${String(next)} hasn't been released yet.`)).toBeVisible();
  });
});
