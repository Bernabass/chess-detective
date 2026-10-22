import { Worker } from 'node:worker_threads';
import type { Candidate, Verified, Verifier } from './candidates';
import { verifyCandidate } from './verify';

export interface VerifierPool {
  verify: Verifier;
  close: () => Promise<void>;
}

/** Candidates per message: small, so slow candidates don't leave other workers idle. */
const CHUNK = 4;

/** Verifies on this thread. */
export function inlineVerifier(nodeLimit: number): VerifierPool {
  return {
    verify: (batch) =>
      Promise.resolve(
        batch.map((candidate) => {
          const t0 = performance.now();
          const verification = verifyCandidate(
            candidate.target,
            candidate.moves.length,
            nodeLimit,
            candidate.moves,
          );
          return { candidate, verification, elapsedMs: performance.now() - t0 };
        }),
      ),
    close: () => Promise.resolve(),
  };
}

/**
 * Verifies on `jobs` worker threads (inline when jobs is 1). Each candidate's verdict depends only
 * on the candidate and the node limit, and results come back in input order, so the output is
 * the same whatever `jobs` is.
 */
export function createVerifier(jobs: number, nodeLimit: number): VerifierPool {
  if (jobs <= 1) return inlineVerifier(nodeLimit);
  // The workers run the TypeScript sources through tsx, like the CLI itself.
  const workers = Array.from(
    { length: jobs },
    () =>
      new Worker(new URL('./worker.ts', import.meta.url), {
        workerData: { nodeLimit },
        execArgv: ['--import', 'tsx'],
      }),
  );

  const verify = (batch: readonly Candidate[]): Promise<Verified[]> =>
    new Promise((resolve, reject) => {
      const results = new Array<Verified[]>(Math.ceil(batch.length / CHUNK));
      let next = 0;
      let pending = 0;
      const cleanups: (() => void)[] = [];
      const finish = (error?: unknown): void => {
        for (const cleanup of cleanups) cleanup();
        if (error === undefined) resolve(results.flat());
        else
          reject(
            error instanceof Error
              ? error
              : new Error('a verification worker failed', { cause: error }),
          );
      };
      const send = (worker: Worker): void => {
        if (next * CHUNK >= batch.length) {
          if (pending === 0) finish();
          return;
        }
        const id = next++;
        pending++;
        worker.postMessage({ id, candidates: batch.slice(id * CHUNK, (id + 1) * CHUNK) });
      };
      for (const worker of workers) {
        const onMessage = (msg: { id: number; results: Verified[] }): void => {
          results[msg.id] = msg.results;
          pending--;
          send(worker);
        };
        const onError = (error: unknown): void => {
          finish(error);
        };
        const onExit = (code: number): void => {
          finish(new Error(`a verification worker exited (code ${String(code)})`));
        };
        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);
        cleanups.push(() => {
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
        });
      }
      if (batch.length === 0) finish();
      else for (const worker of workers) send(worker);
    });

  return {
    verify,
    close: async () => {
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}
