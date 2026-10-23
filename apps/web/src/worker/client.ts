import { proxy, wrap, type Remote } from 'comlink';
import type { LastMovesResult } from '@retrograde/engine';
import type { AnalysisDto, EngineApi, EngineResult, ProveDto, ProveProgress } from './api';

/** Thrown (as a rejected promise) by calls running when cancel() terminated the worker. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export interface EngineClient {
  analyze: (fen: string, depth: number) => Promise<EngineResult<AnalysisDto>>;
  lastMoves: (fen: string, depth: number) => Promise<EngineResult<LastMovesResult>>;
  prove: (
    fen: string,
    maxPlies: number,
    onProgress?: (p: ProveProgress) => void,
  ) => Promise<EngineResult<ProveDto>>;
  /** Stops whatever is running (terminates the worker, SPEC §9.4); the next call starts a fresh one. */
  cancel: () => void;
  /** True while a call is in flight. */
  busy: () => boolean;
  dispose: () => void;
}

export type WorkerFactory = () => Worker;

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'engine' });

/**
 * One engine worker with cancel-by-terminate. A synchronous search can't receive a "stop"
 * message, so cancel() terminates the worker, rejects the calls in flight with CancelledError,
 * and the next call creates a new worker.
 */
export function createEngineClient(factory: WorkerFactory = defaultFactory): EngineClient {
  let worker: Worker | null = null;
  let remote: Remote<EngineApi> | null = null;
  // Rejecters of the calls in flight, so cancel() can settle them.
  const pending = new Set<(e: Error) => void>();

  // Stops the worker and settles every call in flight with `error`.
  const stop = (error: Error): void => {
    worker?.terminate();
    worker = null;
    remote = null;
    for (const reject of pending) reject(error);
    pending.clear();
  };

  const api = (): Remote<EngineApi> => {
    if (remote === null) {
      const w = factory();
      // A worker that fails to load or crashes would otherwise leave its calls pending forever.
      w.addEventListener('error', () => {
        if (worker === w) stop(new Error('The engine worker failed to start or crashed.'));
      });
      worker = w;
      remote = wrap<EngineApi>(w);
    }
    return remote;
  };

  const call = <T>(run: (r: Remote<EngineApi>) => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const rejecter = (e: Error): void => {
        reject(e);
      };
      pending.add(rejecter);
      run(api()).then(
        (value) => {
          if (pending.delete(rejecter)) resolve(value);
        },
        (error: unknown) => {
          if (pending.delete(rejecter))
            reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

  const cancel = (): void => {
    stop(new CancelledError());
  };

  return {
    analyze: (fen, depth) => call(async (r) => await r.analyze(fen, depth)),
    lastMoves: (fen, depth) => call(async (r) => await r.lastMoves(fen, depth)),
    prove: (fen, maxPlies, onProgress) =>
      call(
        async (r) =>
          await r.prove(fen, maxPlies, onProgress === undefined ? undefined : proxy(onProgress)),
      ),
    cancel,
    busy: () => pending.size > 0,
    dispose: cancel,
  };
}
