import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, GUEST_ME, renderApp } from '../test/fakeApi';

vi.mock('../components/Board', async () => ({
  Board: (await import('../test/BoardStub')).BoardStub,
}));

const STATS = {
  played: 5,
  solved: 4,
  winRate: 0.8,
  currentStreak: 3,
  maxStreak: 4,
  guessDistribution: [1, 2, 0, 1, 0, 0, 1],
  averageHints: 0.6,
};
const HOLMES = { guest: false, username: 'holmes', stats: STATS };
const TODAY = { number: 9, day: '2026-11-10', plies: 6, target: 'x w', difficulty: 1 };

describe('accounts', () => {
  it('registers, then returns to where the player came from', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'POST /auth/register': { status: 201, body: HOLMES },
      'GET /leaderboards/all-time?metric=current_streak': {
        body: { metric: 'current_streak', entries: [] },
      },
    });
    const { router } = renderApp('/register?next=%2Fleaderboard%3Fview%3Dall-time', api);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'holmes' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/leaderboard');
    });
    expect(api.calls.find((c) => c.path === '/auth/register')?.body).toEqual({
      username: 'holmes',
      password: 'a long password',
    });
  });

  it('shows the server problem when signing in fails', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'POST /auth/login': {
        status: 401,
        body: {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Wrong username or password.',
        },
      },
    });
    renderApp('/login', api);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'holmes' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  });

  it('says how long to wait when rate limited', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'POST /auth/login': {
        status: 429,
        headers: { 'Retry-After': '42' },
        body: { type: 'about:blank', title: 'Too Many Requests', status: 429 },
      },
    });
    renderApp('/login', api);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'holmes' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 42 seconds');
  });

  it('shows the user in the header, and signs out', async () => {
    let me: unknown = HOLMES;
    const api = fakeApi({
      'GET /auth/me': () => ({ body: me }),
      'POST /auth/logout': () => {
        me = GUEST_ME;
        return { status: 204 };
      },
    });
    const { router } = renderApp('/about', api);
    // The first banner is the site header (page titles are <header>s too).
    const [banner] = await screen.findAllByRole('banner');
    if (banner === undefined) throw new Error('no header');
    expect(await within(banner).findByRole('link', { name: 'holmes' })).toHaveAttribute(
      'href',
      '/u/holmes',
    );
    fireEvent.click(within(banner).getByRole('button', { name: 'Sign out' }));
    expect(await within(banner).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    // The header updates as soon as /auth/me is re-read; the redirect home follows.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('shows Sign in for a guest, coming back to the page', async () => {
    renderApp('/archive', fakeApi({ 'GET /auth/me': { body: GUEST_ME } }));
    // The first banner is the site header (page titles are <header>s too).
    const [banner] = await screen.findAllByRole('banner');
    if (banner === undefined) throw new Error('no header');
    expect(await within(banner).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Farchive',
    );
  });
});

describe('leaderboards', () => {
  it("ranks today's puzzle with times in m:ss or h:mm:ss, and marks you", async () => {
    const entries = [
      { rank: 1, username: 'watson', guesses: 1, hints: 0, seconds: 42 },
      { rank: 2, username: 'holmes', guesses: 2, hints: 1, seconds: 3725 },
    ];
    const api = fakeApi({
      'GET /auth/me': { body: HOLMES },
      'GET /daily': { body: TODAY },
      'GET /leaderboards/daily/9': { body: { number: 9, entries, you: entries[1] } },
    });
    renderApp('/leaderboard', api);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('0:42');
    const [, , mine] = rows;
    if (mine === undefined) throw new Error('no row for you');
    expect(mine).toHaveTextContent('1:02:05');
    expect(within(mine).getByText('You')).toBeInTheDocument();
    expect(within(mine).getByText('1 hour 2 minutes 5 seconds')).toBeInTheDocument();
  });

  it('shows your rank below the list when you are outside it', async () => {
    const entries = [{ rank: 1, username: 'watson', guesses: 1, hints: 0, seconds: 42 }];
    const you = { rank: 150, username: 'holmes', guesses: 6, hints: 3, seconds: 900 };
    const api = fakeApi({
      'GET /auth/me': { body: HOLMES },
      'GET /daily': { body: TODAY },
      'GET /leaderboards/daily/9': { body: { number: 9, entries, you } },
    });
    renderApp('/leaderboard', api);
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('150');
  });

  it('switches to the all-time boards', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /daily': { body: TODAY },
      'GET /leaderboards/daily/9': { body: { number: 9, entries: [] } },
      'GET /leaderboards/all-time?metric=current_streak': {
        body: { metric: 'current_streak', entries: [{ rank: 1, username: 'holmes', value: 12 }] },
      },
      'GET /leaderboards/all-time?metric=solved': {
        body: { metric: 'solved', entries: [{ rank: 1, username: 'watson', value: 40 }] },
      },
    });
    renderApp('/leaderboard', api);
    expect(
      await screen.findByText(/Nobody with an account has solved this one yet/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(await screen.findByRole('link', { name: 'holmes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Solved' }));
    expect(await screen.findByRole('link', { name: 'watson' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solved' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Sign in with Lichess', () => {
  it('starts with a full navigation that returns to where the player came from', async () => {
    renderApp('/register?next=%2Fdaily%2F3', fakeApi({ 'GET /auth/me': { body: GUEST_ME } }));
    const link = await screen.findByRole('link', { name: 'Sign in with Lichess' });
    expect(link).toHaveAttribute('href', '/api/auth/lichess/start?return_to=%2Fdaily%2F3');
  });

  it.each([
    ['cancelled', 'Lichess sign-in was cancelled.'],
    ['expired', 'That Lichess sign-in expired, or was started in another browser.'],
    ['failed', "Couldn't sign in with Lichess."],
    ['busy', 'Too many sign-in attempts from your network.'],
  ])('explains why it came back (%s)', async (reason, text) => {
    renderApp(`/login?lichess=${reason}`, fakeApi({ 'GET /auth/me': { body: GUEST_ME } }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it.each(['%3Cscript%3E', '__proto__', 'constructor', 'toString'])(
    'ignores an unknown reason (%s)',
    async (reason) => {
      renderApp(`/login?lichess=${reason}`, fakeApi({ 'GET /auth/me': { body: GUEST_ME } }));
      await screen.findByRole('link', { name: 'Sign in with Lichess' });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it("links a Lichess user's profile to Lichess", async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /users/Thibault': {
        body: {
          username: 'Thibault',
          joined: '2026-11-01T09:00:00Z',
          stats: STATS,
          lichess: { username: 'Thibault', url: 'https://lichess.org/@/thibault' },
        },
      },
      'GET /users/holmes': {
        body: { username: 'holmes', joined: '2026-11-01T09:00:00Z', stats: STATS },
      },
    });
    renderApp('/u/Thibault', api);
    const link = await screen.findByRole('link', { name: /@Thibault/ });
    expect(link).toHaveAttribute('href', 'https://lichess.org/@/thibault');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows no Lichess link for a password account', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /users/holmes': {
        body: { username: 'holmes', joined: '2026-11-01T09:00:00Z', stats: STATS },
      },
    });
    renderApp('/u/holmes', api);
    await screen.findByText('Win rate');
    expect(screen.queryByText(/Lichess:/)).not.toBeInTheDocument();
  });
});

describe('profiles and the archive', () => {
  it('shows the stats and the guess distribution, with a table for screen readers', async () => {
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /users/holmes': {
        body: { username: 'holmes', joined: '2026-11-01T09:00:00Z', stats: STATS },
      },
    });
    renderApp('/u/holmes', api);
    expect((await screen.findByText('Win rate')).nextSibling).toHaveTextContent('80%');
    expect(screen.getByRole('heading', { level: 1, name: /holmes/ })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: 'Solved in 2 guesses 2' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Failed 1' })).toBeInTheDocument();
  });

  it("says when there's no such user", async () => {
    renderApp('/u/nobody', fakeApi({ 'GET /auth/me': { body: GUEST_ME } }));
    expect(await screen.findByText('No detective by that name.')).toBeInTheDocument();
  });

  it('lists past puzzles with your results, and pages through them', async () => {
    const page = (n: number) => ({
      page: n,
      pageSize: 30,
      total: 31,
      puzzles:
        n === 1
          ? [
              {
                number: 31,
                day: '2026-12-01',
                difficulty: 3,
                plies: 9,
                result: { status: 'solved', guesses: 3, hintsUsed: 1 },
              },
              {
                number: 30,
                day: '2026-11-30',
                difficulty: 2,
                plies: 7,
                result: { status: 'failed', guesses: 6, hintsUsed: 0 },
              },
              { number: 29, day: '2026-11-29', difficulty: 1, plies: 6 },
            ]
          : [{ number: 1, day: '2026-11-01', difficulty: 1, plies: 6 }],
    });
    const api = fakeApi({
      'GET /auth/me': { body: GUEST_ME },
      'GET /archive?page=1': { body: page(1) },
      'GET /archive?page=2': { body: page(2) },
    });
    renderApp('/archive', api);
    const list = await screen.findByRole('list', { name: 'Past puzzles' });
    const items = within(list).getAllByRole('link');
    expect(items[0]).toHaveAttribute('href', '/daily/31');
    expect(items[0]).toHaveTextContent('Solved 3/6');
    expect(items[1]).toHaveTextContent('Failed');
    expect(items[2]).toHaveTextContent('Not played');
    fireEvent.click(screen.getByRole('button', { name: /Older/ }));
    expect(await screen.findByRole('link', { name: /#1/ })).toHaveAttribute('href', '/daily/1');
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });
});
