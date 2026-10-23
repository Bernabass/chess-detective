import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AnalysisDto, ProveDto, ProveProgress } from '../../worker/api';
import { CancelledError, createEngineClient, type EngineClient } from '../../worker/client';

/** One engine worker for this component's lifetime (terminated on unmount). */
function useEngineClient(): RefObject<EngineClient | null> {
  const client = useRef<EngineClient | null>(null);
  useEffect(() => {
    client.current = createEngineClient();
    return () => {
      client.current?.dispose();
      client.current = null;
    };
  }, []);
  return client;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type AnalysisState =
  | { status: 'idle' }
  /** `previous`: the last finished analysis, shown dimmed while the new one runs. */
  | { status: 'running'; previous: AnalysisDto | null }
  | { status: 'done'; result: AnalysisDto }
  | { status: 'error'; message: string };

type Outcome = { ok: true; value: AnalysisDto } | { ok: false; error: string };

/** Debounce before analysing after an edit (SPEC §9.2). */
export const ANALYSIS_DEBOUNCE_MS = 300;

/**
 * Analyses `fen` at `depth` in the analysis worker, 300 ms after the last change. A newer request
 * cancels one still running (terminate and restart: a synchronous search can't be interrupted).
 * The state is derived from the latest finished request, so it's "running" until the result for
 * the current position and depth arrives.
 */
export function useAnalysis(fen: string | null, depth: number): AnalysisState {
  const client = useEngineClient();
  const key = fen === null ? null : `${String(depth)} ${fen}`;
  const [finished, setFinished] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [lastGood, setLastGood] = useState<AnalysisDto | null>(null);

  useEffect(() => {
    if (fen === null || key === null) return;
    let current = true;
    const timer = setTimeout(() => {
      const engine = client.current;
      if (engine === null) return;
      if (engine.busy()) engine.cancel();
      engine.analyze(fen, depth).then(
        (r) => {
          if (!current) return;
          setFinished({ key, outcome: r });
          if (r.ok) setLastGood(r.value);
        },
        (error: unknown) => {
          if (!current || error instanceof CancelledError) return;
          setFinished({ key, outcome: { ok: false, error: message(error) } });
        },
      );
    }, ANALYSIS_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [fen, depth, key, client]);

  if (key === null) return { status: 'idle' };
  if (finished?.key !== key) return { status: 'running', previous: lastGood };
  return finished.outcome.ok
    ? { status: 'done', result: finished.outcome.value }
    : { status: 'error', message: finished.outcome.error };
}

export type ProveState =
  | { status: 'idle' }
  | { status: 'running'; progress: ProveProgress | null }
  | { status: 'done'; result: ProveDto }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/** Proving up to this many plies (SPEC §9.2). */
export const PROVE_MAX_PLIES = 16;

/**
 * "Prove it": the shortest proof game in the prover worker, with progress and Cancel. The state
 * belongs to the position it was started for; for any other position it reads as idle.
 */
export function useProver(fen: string): {
  state: ProveState;
  start: () => void;
  cancel: () => void;
} {
  const client = useEngineClient();
  const [run, setRun] = useState<{ fen: string; state: ProveState } | null>(null);
  const runId = useRef(0);
  // Progress messages already queued when a run is cancelled still arrive afterwards; they must
  // not turn "Cancelled" back into "Searching…".
  const stopped = useRef(0);
  // Whether a search is in flight (a run's final state ends it).
  const searching = useRef(false);

  const start = useCallback(() => {
    const engine = client.current;
    if (engine === null) return;
    if (engine.busy()) engine.cancel();
    const id = ++runId.current;
    const update = (state: ProveState): void => {
      if (runId.current !== id) return;
      searching.current = state.status === 'running';
      setRun({ fen, state });
    };
    update({ status: 'running', progress: null });
    engine
      .prove(fen, PROVE_MAX_PLIES, (progress) => {
        if (stopped.current !== id) update({ status: 'running', progress });
      })
      .then(
        (r) => {
          update(
            r.ok ? { status: 'done', result: r.value } : { status: 'error', message: r.error },
          );
        },
        (error: unknown) => {
          update(
            error instanceof CancelledError
              ? { status: 'cancelled' }
              : { status: 'error', message: message(error) },
          );
        },
      );
  }, [client, fen]);

  const cancel = useCallback(() => {
    stopped.current = runId.current;
    client.current?.cancel();
  }, [client]);

  // Abandons a search still in flight: its late results and progress are ignored, its worker
  // stops, and its state is cleared (its result will never arrive, so coming back to the
  // position must show "idle", not "Searching…"). A finished run is left alone.
  const abandon = useCallback(() => {
    if (!searching.current) return;
    searching.current = false;
    stopped.current = runId.current;
    runId.current++;
    client.current?.cancel();
    setRun(null);
  }, [client]);

  // Leaving the position (an edit, a take-back, Back) stops a search still running for it.
  const running = run !== null && run.fen === fen && run.state.status === 'running';
  useEffect(() => (running ? abandon : undefined), [running, fen, abandon]);

  return {
    state: run !== null && run.fen === fen ? run.state : { status: 'idle' },
    start,
    cancel,
  };
}
