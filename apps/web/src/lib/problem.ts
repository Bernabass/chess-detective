import type { Problem } from '../api/types';

/**
 * An API failure as the UI shows it. The API answers errors with RFC 9457 problem+json
 * (title, detail, and `ply` for an invalid guess); a 429 also says when to retry.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly ply: number | undefined;
  /** Seconds to wait before retrying (429 only). */
  readonly retryAfter: number | undefined;

  constructor(status: number, message: string, ply?: number, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.ply = ply;
    this.retryAfter = retryAfter;
  }
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null && 'status' in value && 'title' in value;
}

/** Builds the ApiError for a failed openapi-fetch call. */
export function apiError(error: unknown, response: Response): ApiError {
  const retry = Number(response.headers.get('Retry-After'));
  const retryAfter = response.status === 429 && retry > 0 ? retry : undefined;
  if (response.status === 429) {
    return new ApiError(
      429,
      `Too many requests. Try again in ${String(retryAfter ?? 60)} seconds.`,
      undefined,
      retryAfter,
    );
  }
  if (isProblem(error)) {
    return new ApiError(response.status, error.detail ?? error.title, error.ply);
  }
  return new ApiError(response.status, `The server answered ${String(response.status)}.`);
}

/** A message for any error a query or mutation can throw (including network failures). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Can't reach the server. Check your connection and try again.";
}

/** Unwraps an openapi-fetch result: the data, or an ApiError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  throw apiError(result.error, result.response);
}
