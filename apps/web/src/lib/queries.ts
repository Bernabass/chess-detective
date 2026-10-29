import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AllTimeLeaderboard,
  Archive,
  DailyLeaderboard,
  GuessResult,
  HintResult,
  Me,
  Metric,
  Profile,
  Puzzle,
} from '../api/types';
import { useApi } from './api';
import { apiError, unwrap } from './problem';

// Server state goes through TanStack Query (web rule). Every call goes through the generated,
// typed client; errors become ApiError (lib/problem.ts).

export const keys = {
  me: ['me'] as const,
  puzzles: ['puzzle'] as const,
  puzzle: (number: number | undefined) => ['puzzle', number ?? 'today'] as const,
  boards: ['leaderboard'] as const,
  daily: (number: number) => ['leaderboard', 'daily', number] as const,
  allTime: (metric: Metric) => ['leaderboard', 'all-time', metric] as const,
  profile: (username: string) => ['profile', username] as const,
  archive: (page: number) => ['archive', page] as const,
};

export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<Me> => unwrap(await api.GET('/auth/me')),
    staleTime: 30_000,
  });
}

/** Today's puzzle (number undefined) or puzzle `number`. Reading creates nothing. */
export function usePuzzle(number: number | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.puzzle(number),
    enabled,
    // After midnight a refetch would swap today's puzzle (and the board in progress) for the new one.
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Puzzle> =>
      number === undefined
        ? unwrap(await api.GET('/daily'))
        : unwrap(await api.GET('/daily/{number}', { params: { path: { number } } })),
  });
}

/** Puts a fresh puzzle (with the caller's attempt) into both of its cache entries. */
function usePutPuzzle() {
  const qc = useQueryClient();
  return (p: Puzzle): void => {
    qc.setQueryData(keys.puzzle(p.number), p);
    const today = qc.getQueryData<Puzzle>(keys.puzzle(undefined));
    if (today?.number === p.number) qc.setQueryData(keys.puzzle(undefined), p);
  };
}

/** Starts the caller's attempt (creating a guest session if needed); idempotent. */
export function useStartPuzzle() {
  const api = useApi();
  const qc = useQueryClient();
  const put = usePutPuzzle();
  return useMutation({
    mutationFn: async (number: number): Promise<Puzzle> =>
      unwrap(await api.POST('/daily/{number}/start', { params: { path: { number } }, body: {} })),
    onSuccess: (p) => {
      put(p);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

/** Re-reads the puzzle after a guess or hint, so the attempt (guesses, hints, solution) is current. */
function useRefreshPuzzle() {
  const api = useApi();
  const qc = useQueryClient();
  const put = usePutPuzzle();
  return async (number: number, finished: boolean): Promise<void> => {
    try {
      put(unwrap(await api.GET('/daily/{number}', { params: { path: { number } } })));
    } catch {
      // The guess or hint was recorded: never report it as failed (a retry would spend another
      // one). The page re-reads the puzzle as soon as it can.
      await qc.invalidateQueries({ queryKey: keys.puzzles });
    }
    if (finished) {
      await qc.invalidateQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.boards });
      await qc.invalidateQueries({ queryKey: ['archive'] });
    }
  };
}

export function useSubmitGuess() {
  const api = useApi();
  const refresh = useRefreshPuzzle();
  return useMutation({
    mutationFn: async (v: { number: number; moves: string[] }): Promise<GuessResult> => {
      const r = unwrap(
        await api.POST('/daily/{number}/guesses', {
          params: { path: { number: v.number } },
          body: { moves: v.moves },
        }),
      );
      await refresh(v.number, r.status !== 'in_progress');
      return r;
    },
  });
}

export function useTakeHint() {
  const api = useApi();
  const refresh = useRefreshPuzzle();
  return useMutation({
    mutationFn: async (number: number): Promise<HintResult> => {
      const r = unwrap(
        await api.POST('/daily/{number}/hints', { params: { path: { number } }, body: {} }),
      );
      await refresh(number, false);
      return r;
    },
  });
}

/** After signing in, up or out, everything the caller sees may change (guest merge, stats). */
function useAfterAuth() {
  const qc = useQueryClient();
  return async (me: Me | null): Promise<void> => {
    if (me !== null) qc.setQueryData(keys.me, me);
    await qc.invalidateQueries();
  };
}

export function useLogin() {
  const api = useApi();
  const after = useAfterAuth();
  return useMutation({
    mutationFn: async (body: { username: string; password: string }): Promise<Me> =>
      unwrap(await api.POST('/auth/login', { body })),
    onSuccess: after,
  });
}

export function useRegister() {
  const api = useApi();
  const after = useAfterAuth();
  return useMutation({
    mutationFn: async (body: { username: string; password: string }): Promise<Me> =>
      unwrap(await api.POST('/auth/register', { body })),
    onSuccess: after,
  });
}

export function useLogout() {
  const api = useApi();
  const after = useAfterAuth();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      // No body, but every state-changing request must say JSON (the API's CSRF check).
      const r = await api.POST('/auth/logout', { headers: { 'Content-Type': 'application/json' } });
      if (!r.response.ok) throw apiError(r.error, r.response);
    },
    onSuccess: () => after(null),
  });
}

export function useDailyLeaderboard(number: number | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: keys.daily(number ?? 0),
    enabled: number !== undefined,
    queryFn: async (): Promise<DailyLeaderboard> =>
      unwrap(
        await api.GET('/leaderboards/daily/{number}', {
          params: { path: { number: number ?? 1 }, query: { limit: 100 } },
        }),
      ),
  });
}

export function useAllTimeLeaderboard(metric: Metric) {
  const api = useApi();
  return useQuery({
    queryKey: keys.allTime(metric),
    queryFn: async (): Promise<AllTimeLeaderboard> =>
      unwrap(await api.GET('/leaderboards/all-time', { params: { query: { metric } } })),
  });
}

export function useProfile(username: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.profile(username),
    queryFn: async (): Promise<Profile> =>
      unwrap(await api.GET('/users/{username}', { params: { path: { username } } })),
    retry: false,
  });
}

export function useArchive(page: number) {
  const api = useApi();
  return useQuery({
    queryKey: keys.archive(page),
    queryFn: async (): Promise<Archive> =>
      unwrap(await api.GET('/archive', { params: { query: { page } } })),
  });
}
