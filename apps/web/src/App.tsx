import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from './api/client';

type ApiStatus = 'ok' | 'unavailable';

async function fetchApiStatus(api: ApiClient): Promise<ApiStatus> {
  try {
    const { data } = await api.GET('/health');
    return data?.status === 'ok' && data.db === 'ok' ? 'ok' : 'unavailable';
  } catch {
    // Network error: the API isn't running.
    return 'unavailable';
  }
}

/** Phase 0 placeholder page: proves the web app can reach the API through the Vite proxy. */
export function App({ api }: { api: ApiClient }) {
  const { data: status } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApiStatus(api),
  });

  return (
    <main>
      <h1>Retrograde</h1>
      <p>Chess detective puzzles built on retrograde analysis.</p>
      <p role="status">{status === undefined ? 'API: checking…' : `API: ${status}`}</p>
    </main>
  );
}
