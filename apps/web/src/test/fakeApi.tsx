import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { createApiClient } from '../api/client';
import { ApiContext } from '../lib/api';
import { routes } from '../router';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
type Handler = (call: Call) => Reply | undefined;

/**
 * A fake API for component tests: `handle` answers "METHOD /path" (path under /api, query
 * string included when given) with JSON. Unhandled calls get a 404 problem. Every call is
 * recorded in `calls`.
 */
export function fakeApi(handlers: Record<string, Reply | Handler>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: Request | string | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '');
    const text = req.method === 'GET' ? '' : await req.text();
    const call: Call = {
      method: req.method,
      path,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    };
    calls.push(call);
    const handler =
      handlers[`${req.method} ${path}${url.search}`] ?? handlers[`${req.method} ${path}`];
    const reply = typeof handler === 'function' ? handler(call) : handler;
    if (reply === undefined) {
      return new Response(
        JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      );
    }
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: {
        'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
        ...reply.headers,
      },
    });
  };
  return { client: createApiClient(fetchImpl), calls };
}

/** Renders the app at `path` with a fake API. */
export function renderApp(path: string, api: ReturnType<typeof fakeApi>, extra?: ReactNode) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ApiContext.Provider value={api.client}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {extra}
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return { router };
}

export const GUEST_ME = {
  guest: true,
  stats: {
    played: 0,
    solved: 0,
    winRate: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0, 0],
    averageHints: 0,
  },
};
