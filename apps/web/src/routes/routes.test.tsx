import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { ApiContext } from '../lib/api';
import { routes } from '../router';
import { analyze, lastMoves, prove } from '../worker/api';
import type { EngineClient } from '../worker/client';

vi.mock('../components/Board', async () => ({
  Board: (await import('../test/BoardStub')).BoardStub,
}));

// The Lab's engine runs in a Web Worker; here the same functions run in-process.
vi.mock('../worker/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../worker/client')>();
  return {
    ...original,
    createEngineClient: (): EngineClient => ({
      analyze: (fen, depth) => Promise.resolve(analyze(fen, depth)),
      lastMoves: (fen, depth) => Promise.resolve(lastMoves(fen, depth)),
      prove: (fen, maxPlies, onProgress) => Promise.resolve(prove(fen, maxPlies, onProgress)),
      cancel: () => undefined,
      busy: () => false,
      dispose: () => undefined,
    }),
  };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const offline = createApiClient(() => Promise.reject(new TypeError('offline')));
  render(
    <ApiContext.Provider value={offline}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
}

const PAGES: [string, RegExp][] = [
  ['/', /Don't ask for the best move/],
  ['/daily', /Daily proof game/],
  ['/daily/12', /Retrograde #12/],
  ['/archive', /Archive/],
  ['/leaderboard', /Leaderboard/],
  ['/u/holmes', /holmes/],
  ['/login', /Sign in/],
  ['/register', /Create an account/],
  ['/about', /Thinking backwards/],
  ['/lab', /The Lab/],
  ['/no/such/page', /This case file doesn't exist/],
];

describe('routes', () => {
  it.each(PAGES)('%s renders its page inside the layout', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
    expect(await screen.findByText('Server: offline')).toBeInTheDocument();
  });

  it('the Lab analyses the position in the link', async () => {
    renderAt(`/lab?fen=${encodeURIComponent('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1')}`);
    expect(await screen.findByText('Illegal', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByText(/has no possible starting file/).length).toBeGreaterThan(0);
  });

  it('the Lab says when the link holds an invalid FEN', async () => {
    renderAt('/lab?fen=not-a-fen');
    expect(await screen.findByText(/isn't a valid FEN/)).toBeInTheDocument();
  });
});
