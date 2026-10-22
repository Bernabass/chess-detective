// Worker thread entry: verifies the candidates it is sent (see workers.ts).
import { parentPort, workerData } from 'node:worker_threads';
import type { Candidate, Verified } from './candidates';
import { verifyCandidate } from './verify';

interface Job {
  id: number;
  candidates: Candidate[];
}

const { nodeLimit } = workerData as { nodeLimit: number };
const port = parentPort;
if (port === null) throw new Error('worker.ts must run in a worker thread');

port.on('message', (job: Job) => {
  const results: Verified[] = job.candidates.map((candidate) => {
    const t0 = performance.now();
    const verification = verifyCandidate(
      candidate.target,
      candidate.moves.length,
      nodeLimit,
      candidate.moves,
    );
    return { candidate, verification, elapsedMs: performance.now() - t0 };
  });
  port.postMessage({ id: job.id, results });
});
