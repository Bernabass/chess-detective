import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Puzzle } from '../../api/types';
import { fakeApi, GUEST_ME, renderApp } from '../../test/fakeApi';

vi.mock('../../components/Board', async () => ({
  Board: (await import('../../test/BoardStub')).BoardStub,
}));

const SOLUTION = ['e2e4', 'e7e5', 'e1e2', 'e8e7'];
const TODAY = new Date().toISOString().slice(0, 10);
const base: Puzzle = {
  number: 4,
  day: TODAY,
  plies: 4,
  target: 'rnbq1bnr/ppppkppp/8/4p3/4P3/8/PPPPKPPP/RNBQ1BNR w',
  difficulty: 1,
};
const started = {
  status: 'in_progress' as const,
  archive: false,
  guesses: [],
  hintsUsed: 0,
  hints: [],
  startedAt: '2026-11-04T10:00:00Z',
};

const typeMoves = (moves: string[]): void => {
  const input = screen.getByPlaceholderText(/Type a move/);
  for (const m of moves) {
    fireEvent.change(input, { target: { value: m } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  }
};

describe('the daily game', () => {
  beforeEach(() => {
    window.localStorage.setItem('retrograde.howToPlay.seen', '1');
  });

  it('starts the attempt when shown (the GET creates nothing) and plays a guess', async () => {
    let puzzle: Puzzle = base;
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': () => ({ body: puzzle }),
      'GET /daily/4': () => ({ body: puzzle }),
      'POST /daily/4/start': () => {
        puzzle = { ...base, attempt: started };
        return { body: puzzle };
      },
      'POST /daily/4/guesses': () => {
        puzzle = {
          ...base,
          attempt: {
            ...started,
            guesses: [{ moves: ['g1f3', 'e7e5', 'e2e4', 'e8e7'], feedback: 'XGYG' }],
          },
        };
        return { body: { feedback: 'XGYG', status: 'in_progress', guessesUsed: 1 } };
      },
    });
    renderApp('/daily', api);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Retrograde #4' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        api.calls.filter((c) => c.method === 'POST' && c.path === '/daily/4/start'),
      ).toHaveLength(1);
    });
    expect(screen.getByTestId('ply-counter')).toHaveTextContent('0 / 4');

    const submit = screen.getByRole('button', { name: /Submit guess/ });
    typeMoves(['Nf3', 'e5', 'e4']);
    expect(submit).toBeDisabled();
    typeMoves(['Ke7']);
    expect(screen.getByTestId('ply-counter')).toHaveTextContent('4 / 4');
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => {
      expect(api.calls.find((c) => c.path === '/daily/4/guesses')?.body).toEqual({
        moves: ['g1f3', 'e7e5', 'e2e4', 'e8e7'],
      });
    });
    // The result is announced, and the row reads every ply.
    expect(
      await screen.findByText('Guess 1 of 6: 2 right, 1 in another ply, 1 not in the solution.'),
    ).toBeInTheDocument();
    const guesses = await screen.findByRole('list', { name: 'Your guesses' });
    expect(within(guesses).getByRole('button')).toHaveAccessibleName(
      /Guess 1\. Ply 1, Nf3: not in the solution\. Ply 2, e5: right move, right ply\. Ply 3, e4: right move, another ply\. Ply 4, Ke7: right move, right ply\./,
    );
    // The same game can't be submitted twice.
    expect(screen.getByRole('button', { name: /Submit guess/ })).toBeDisabled();
    expect(screen.getByText(/you already tried this game/)).toBeInTheDocument();
  });

  it("can't submit before the attempt has started, and a failed start can be retried", async () => {
    let up = false;
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': { body: base },
      'POST /daily/4/start': () =>
        up
          ? { body: { ...base, attempt: started } }
          : {
              status: 503,
              body: {
                type: 'about:blank',
                title: 'Service Unavailable',
                status: 503,
                detail: 'Down.',
              },
            },
    });
    renderApp('/daily', api);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the puzzle: Down.");
    typeMoves(['e4', 'e5', 'Ke2', 'Ke7']);
    expect(screen.getByTestId('ply-counter')).toHaveTextContent('4 / 4');
    expect(screen.getByRole('button', { name: /Submit guess/ })).toBeDisabled();

    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Submit guess/ })).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a recorded guess as recorded even if re-reading the puzzle fails', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': { body: { ...base, attempt: started } },
      'GET /daily/4': { status: 500, body: { type: 'about:blank', title: 'Error', status: 500 } },
      'POST /daily/4/guesses': {
        body: { feedback: 'XGYG', status: 'in_progress', guessesUsed: 1 },
      },
    });
    renderApp('/daily', api);
    await screen.findByTestId('ply-counter');
    typeMoves(['Nf3', 'e5', 'e4', 'Ke7']);
    fireEvent.click(screen.getByRole('button', { name: /Submit guess/ }));
    expect(
      await screen.findByText('Guess 1 of 6: 2 right, 1 in another ply, 1 not in the solution.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads a previous guess onto the board when its row is tapped', async () => {
    const puzzle: Puzzle = {
      ...base,
      attempt: {
        ...started,
        guesses: [{ moves: ['g1f3', 'e7e5', 'e2e4', 'e8e7'], feedback: 'XGYG' }],
      },
    };
    const api = fakeApi({ 'GET /auth/me': { body: GUEST_ME }, 'GET /daily': { body: puzzle } });
    renderApp('/daily', api);
    const row = await screen.findByRole('button', { name: /Guess 1\./ });
    fireEvent.click(row);
    expect(screen.getByTestId('ply-counter')).toHaveTextContent('4 / 4');
    expect(screen.getByRole('list', { name: 'Your moves' })).toHaveTextContent('1.Nf3');
    // Starting is only for puzzles without an attempt.
    expect(api.calls.some((c) => c.path.endsWith('/start'))).toBe(false);
  });

  it('takes hints one at a time', async () => {
    let puzzle: Puzzle = { ...base, attempt: started };
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': () => ({ body: puzzle }),
      'GET /daily/4': () => ({ body: puzzle }),
      'POST /daily/4/hints': () => {
        const hint = {
          kind: 'movers' as const,
          text: 'White moved: king, pawn. Black moved: king, pawn.',
          white: ['king', 'pawn'],
          black: ['king', 'pawn'],
        };
        puzzle = { ...base, attempt: { ...started, hintsUsed: 1, hints: [hint] } };
        return { body: { hintIndex: 1, hint } };
      },
    });
    renderApp('/daily', api);
    fireEvent.click(await screen.findByRole('button', { name: /Take hint 1 of 3/ }));
    expect(await screen.findByTestId('hint-1')).toHaveTextContent(
      'White moved: king, pawn. Black moved: king, pawn.',
    );
    expect(screen.getByRole('button', { name: /Take hint 2 of 3/ })).toBeInTheDocument();
  });

  it('shows the result, the solution, the share card and the countdown after a solve', async () => {
    const puzzle: Puzzle = {
      ...base,
      solution: SOLUTION,
      attempt: {
        ...started,
        status: 'solved',
        guesses: [
          { moves: ['g1f3', 'e7e5', 'e2e4', 'e8e7'], feedback: 'XGYG' },
          { moves: SOLUTION, feedback: 'GGGG' },
        ],
        hintsUsed: 1,
        finishedAt: '2026-11-04T11:02:05Z',
      },
    };
    const api = fakeApi({ 'GET /auth/me': { body: GUEST_ME }, 'GET /daily': { body: puzzle } });
    renderApp('/daily', api);
    expect(await screen.findByRole('heading', { name: 'Case closed' })).toBeInTheDocument();
    expect(screen.getByText(/Solved in 2\/6 with 1 hint/)).toBeInTheDocument();
    expect(screen.getByText('1:02:05')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Proof game moves' })).toHaveTextContent('2.Ke2');
    expect(screen.getByTestId('share-text').textContent).toContain('Retrograde #4');
    expect(screen.getByTestId('share-text').textContent.split(String.fromCharCode(10))[1]).toBe(
      `2/6 ${String.fromCodePoint(0x00b7)} ${String.fromCodePoint(0x1f50d)}1`,
    );
    expect(screen.getByRole('timer')).toHaveTextContent(/^\d+:\d\d:\d\d$/);
    expect(screen.getByText(/Next puzzle in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?next=%2Fdaily',
    );
    expect(screen.queryByRole('button', { name: /Submit guess/ })).not.toBeInTheDocument();
  });

  it('moves focus to the result when the last guess finishes the game', async () => {
    let puzzle: Puzzle = { ...base, attempt: started };
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': () => ({ body: puzzle }),
      'GET /daily/4': () => ({ body: puzzle }),
      'POST /daily/4/guesses': () => {
        puzzle = {
          ...base,
          solution: SOLUTION,
          attempt: {
            ...started,
            status: 'solved',
            guesses: [{ moves: SOLUTION, feedback: 'GGGG' }],
            finishedAt: '2026-11-04T10:01:00Z',
          },
        };
        return { body: { feedback: 'GGGG', status: 'solved', guessesUsed: 1, solution: SOLUTION } };
      },
    });
    renderApp('/daily', api);
    await screen.findByTestId('ply-counter');
    typeMoves(['e4', 'e5', 'Ke2', 'Ke7']);
    fireEvent.click(screen.getByRole('button', { name: /Submit guess/ }));
    const heading = await screen.findByRole('heading', { name: 'Case closed' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it('says at once that the next puzzle is out when the finished one is from an earlier day', async () => {
    const puzzle: Puzzle = {
      ...base,
      number: 3,
      day: '2026-01-02',
      solution: SOLUTION,
      attempt: {
        ...started,
        status: 'solved',
        guesses: [{ moves: SOLUTION, feedback: 'GGGG' }],
        finishedAt: '2026-01-02T10:01:00Z',
      },
    };
    const api = fakeApi({ 'GET /auth/me': { body: GUEST_ME }, 'GET /daily/3': { body: puzzle } });
    renderApp('/daily/3', api);
    expect(await screen.findByText('A new puzzle is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Leaderboard for #3/ })).toHaveAttribute(
      'href',
      '/leaderboard?number=3',
    );
  });

  it('marks archive play as practice and shows a failed result', async () => {
    const puzzle: Puzzle = {
      ...base,
      number: 2,
      day: '2026-01-02',
      solution: SOLUTION,
      attempt: {
        ...started,
        archive: true,
        status: 'failed',
        guesses: Array.from({ length: 6 }, () => ({
          moves: ['b1a3', 'b8a6', 'a3b1', 'a6b8'],
          feedback: 'XXXX',
        })),
        finishedAt: '2026-11-04T10:30:00Z',
      },
    };
    const api = fakeApi({ 'GET /auth/me': { body: GUEST_ME }, 'GET /daily/2': { body: puzzle } });
    renderApp('/daily/2', api);
    expect(await screen.findByRole('heading', { name: 'Case unsolved' })).toBeInTheDocument();
    expect(screen.getByText(/Practice: an archive puzzle/)).toBeInTheDocument();
    const share = screen.getByTestId('share-text').textContent;
    expect(share).toContain('Retrograde #2 (practice)');
    expect(share.split(String.fromCharCode(10))[1]).toBe('X/6');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it("says when a puzzle isn't released yet", async () => {
    const api = fakeApi({ 'GET /auth/me': { body: GUEST_ME } });
    renderApp('/daily/99', api);
    expect(await screen.findByText("Puzzle #99 hasn't been released yet.")).toBeInTheDocument();
  });
});

describe('How to play', () => {
  it('opens on the first visit only, and can be reopened', async () => {
    window.localStorage.removeItem('retrograde.howToPlay.seen');
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': { body: { ...base, attempt: started } },
    });
    renderApp('/daily', api);
    const dialog = await screen.findByRole('dialog', { name: 'How to play' });
    expect(dialog).toHaveAttribute('open');
    expect(window.localStorage.getItem('retrograde.howToPlay.seen')).toBe('1');
    // The example row reads its feedback.
    expect(within(dialog).getByText(/Ply 1, Nf3: not in the solution/)).toBeInTheDocument();
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start playing' }));
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'How to play' })).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(await screen.findByRole('dialog', { name: 'How to play' })).toBeInTheDocument();
  });
});
