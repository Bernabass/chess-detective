import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createApiClient } from './api/client';

function renderWithFetch(fetchImpl: typeof fetch) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App api={createApiClient(fetchImpl)} />
    </QueryClientProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('App', () => {
  it('shows "API: ok" when the health check passes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(200, { status: 'ok', db: 'ok' })),
    );
    renderWithFetch(fetchImpl);

    expect(await screen.findByText('API: ok')).toBeInTheDocument();
    const request = fetchImpl.mock.calls[0]?.[0];
    expect(request instanceof Request ? new URL(request.url).pathname : request).toBe(
      '/api/health',
    );
  });

  it('shows "API: unavailable" when the database is down', async () => {
    renderWithFetch(() =>
      Promise.resolve(jsonResponse(503, { status: 'unavailable', db: 'error' })),
    );
    expect(await screen.findByText('API: unavailable')).toBeInTheDocument();
  });

  it('shows "API: unavailable" when the API is unreachable', async () => {
    renderWithFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await screen.findByText('API: unavailable')).toBeInTheDocument();
  });
});
