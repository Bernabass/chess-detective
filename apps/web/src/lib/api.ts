import { createContext, useContext } from 'react';
import { createApiClient, type ApiClient } from '../api/client';

/** The API client, provided at the root (tests pass one with a fake fetch). */
export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  return api ?? defaultClient();
}

let shared: ApiClient | null = null;
function defaultClient(): ApiClient {
  shared ??= createApiClient();
  return shared;
}

export type ApiStatus = 'ok' | 'unavailable';

export async function fetchApiStatus(api: ApiClient): Promise<ApiStatus> {
  try {
    const { data } = await api.GET('/health');
    return data?.status === 'ok' && data.db === 'ok' ? 'ok' : 'unavailable';
  } catch {
    // Network error: the API isn't running.
    return 'unavailable';
  }
}
