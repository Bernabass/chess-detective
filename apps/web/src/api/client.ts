import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type ApiClient = ReturnType<typeof createClient<paths>>;

/** Typed client for the Go API. Types are generated from api/openapi.yaml by `pnpm gen`. */
export function createApiClient(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): ApiClient {
  return createClient<paths>({
    baseUrl: new URL('/api', window.location.origin).toString(),
    fetch: fetchImpl,
  });
}
