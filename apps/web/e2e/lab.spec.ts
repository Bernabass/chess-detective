import { expect, test, type Page } from '@playwright/test';
import { EXAMPLES } from '../src/features/lab/examples';

const lab = (fen: string): string => `/lab?fen=${encodeURIComponent(fen)}`;
const verdict = (page: Page) => page.locator('[data-verdict]');

test.describe('Lab', () => {
  test('an illegal example shows the verdict and the reason (SPEC Phase 5)', async ({ page }) => {
    await page.goto('/lab');
    await page.getByRole('link', { name: /Three pawns, two files/ }).click();
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'illegal');
    await expect(verdict(page)).toContainText('Illegal');
    await expect(verdict(page)).toContainText('the pawn on a3 has no possible starting file');
    await expect(page).toHaveURL(/fen=k7%2F8%2F8%2F8%2F8%2FPP6%2FPP6%2FK7/);
  });

  test('every example opens with the verdict the gallery promises', async ({ page }) => {
    await page.goto('/lab');
    for (const ex of EXAMPLES) {
      await page.getByRole('link', { name: ex.title }).click();
      await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(
        new RegExp(`^${ex.fen.split(' ')[0] ?? ''}`.replaceAll('/', '\\/')),
      );
      await expect(verdict(page)).toHaveAttribute('data-verdict', ex.verdict);
    }
  });

  test('pasting a FEN analyses it automatically and updates the link', async ({ page }) => {
    await page.goto('/lab');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'legal');
    const fen = page.getByLabel('FEN', { exact: true });
    await fen.fill('4k3/8/3N4/1B6/8/8/8/4R2K b');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'illegal');
    await expect(verdict(page)).toContainText('check from 3 pieces');
    await expect(page).toHaveURL(/fen=4k3%2F8%2F3N4/);

    await fen.fill('rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w');
    await expect(fen).toHaveAttribute('aria-invalid', 'true');
    const errorId = await fen.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${errorId ?? ''}"]`)).not.toBeEmpty();
    // The position (and the link) stay as they were.
    await expect(page).toHaveURL(/fen=4k3%2F8%2F3N4/);
  });

  test('placing a piece with click-to-place re-analyses the board', async ({ page }) => {
    await page.goto('/lab');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'legal');
    await page.getByRole('button', { name: 'Place white queen' }).click();
    await page.getByRole('button', { name: 'Place white queen on e4' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Place white queen on e4' })).toHaveCount(0);
    // A second white queen with all 8 pawns at home would have to be a promoted pawn: illegal.
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'illegal');
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(
      /^rnbqkbnr\/pppppppp\/8\/8\/4Q3\//,
    );
  });

  test('click-to-place puts the piece on the right square with the board flipped', async ({
    page,
  }) => {
    await page.goto(lab('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
    await expect(verdict(page)).toBeVisible();
    await page.getByRole('button', { name: 'Flip' }).click();
    await page.getByRole('button', { name: 'Place white knight' }).click();
    // In Black's orientation the top-left square is h1; the button names the real square.
    const squares = page.getByRole('group', { name: 'Place white knight' }).getByRole('button');
    await expect(squares.first()).toHaveAccessibleName('Place white knight on h1');
    await page.getByRole('button', { name: 'Place white knight on c6' }).click();
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(/^4k3\/8\/2N5\//);
    // Escape leaves the mode and returns focus to the palette piece.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Place white knight' })).toBeFocused();
  });

  test('dragging a king two squares does not castle in the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(lab('4k3/8/8/8/8/8/8/4K2R w K - 0 1'));
    await expect(verdict(page)).toBeVisible();
    const box = await page.locator('cg-board').first().boundingBox();
    if (box === null) throw new Error('no board');
    const at = (file: number, rank: number): [number, number] => [
      box.x + ((file + 0.5) * box.width) / 8,
      box.y + ((7 - rank + 0.5) * box.height) / 8,
    ];
    const [ex, ey] = at(4, 0); // e1
    const [gx, gy] = at(6, 0); // g1
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    await page.mouse.move(gx, gy, { steps: 6 });
    await page.mouse.up();
    // The king moved alone; the rook is still on h1.
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(
      /^4k3\/8\/8\/8\/8\/8\/8\/6KR /,
    );
  });

  test('dragging a piece from the palette onto the board edits the position', async ({ page }) => {
    // Tall enough to see the palette and the whole board at once (a drag can't scroll).
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(lab('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
    await expect(verdict(page)).toBeVisible();
    const source = page.getByRole('button', { name: 'Place black rook' });
    const board = page.locator('cg-board').first();
    const box = await board.boundingBox();
    const from = await source.boundingBox();
    if (box === null || from === null) throw new Error('no layout');
    // a8 is the top-left square in White's orientation.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 16, box.y + box.height / 16, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(/^r3k3\//);
  });

  test('hovering a detective note highlights its squares on the board', async ({ page }) => {
    await page.goto(lab('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1'));
    const note = page.getByRole('button', { name: /could only have started/ });
    await note.hover();
    await expect(page.locator('cg-board square.note-highlight')).toHaveCount(3);
    await page.getByRole('heading', { name: 'The Lab' }).hover();
    await expect(page.locator('cg-board square.note-highlight')).toHaveCount(0);
  });

  test('taking back a last move loads the prior position, and Back returns', async ({ page }) => {
    const start = lab('6k1/4Kppp/8/8/8/8/8/8 w - - 0 1');
    await page.goto(start);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'undecided');
    await page.getByRole('button', { name: 'Take back …Kh8-g8' }).click();
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(
      '7k/4Kppp/8/8/8/8/8/8 b - - 0 1',
    );
    await page.goBack();
    await expect(page.getByLabel('FEN', { exact: true })).toHaveValue(
      '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1',
    );
  });

  test('Prove it finds a proof with progress and plays it back', async ({ page }) => {
    await page.goto(lab('rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1'));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'undecided');
    await page.getByRole('button', { name: 'Prove it' }).click();
    await expect(page.getByText(/Found a shortest proof game: 12 plies/).first()).toBeVisible({
      timeout: 30_000,
    });
    const scrubber = page.getByRole('slider', { name: 'Proof game position' });
    await expect(scrubber).toHaveValue('12');
    await page.getByRole('button', { name: '5.O-O' }).click();
    await expect(scrubber).toHaveValue('9');
  });

  test('Cancel stops a proof search, and the Lab keeps working', async ({ page }) => {
    // Unreachable (White to move with one extra white move), so the search runs to 16 plies.
    await page.goto(lab('rnbqkbnr/pppppppp/8/8/8/N7/PPPPPPPP/R1BQKBNR w - - 0 1'));
    await expect(verdict(page)).toBeVisible();
    await page.getByRole('button', { name: 'Prove it' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelled.', { exact: true }).first()).toBeVisible();

    // The prover worker was replaced: a second search runs again.
    await page.getByRole('button', { name: 'Prove it' }).click();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelled.', { exact: true }).first()).toBeVisible();

    await page.getByLabel('FEN', { exact: true }).fill('k7/8/8/8/8/8/8/K6P w');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'illegal');
  });

  test('Copy link copies the permalink, and Open in Lichess points at its editor', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(lab('6k1/4Kppp/8/8/8/8/8/8 w - - 0 1'));
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/lab\?fen=6k1%2F4Kppp%2F8%2F8%2F8%2F8%2F8%2F8%20w%20-%20-%200%201$/);
    await expect(page.getByRole('link', { name: /Open in Lichess/ })).toHaveAttribute(
      'href',
      'https://lichess.org/editor/6k1/4Kppp/8/8/8/8/8/8_w_-_-_0_1',
    );
  });
});
