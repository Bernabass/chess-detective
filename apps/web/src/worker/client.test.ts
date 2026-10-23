// @vitest-environment node
import { expose } from 'comlink';
import { describe, expect, it } from 'vitest';
import { analyze, type EngineApi } from './api';
import { CancelledError, createEngineClient } from './client';

/** A stand-in "worker": a MessageChannel with the API exposed on the other end. */
function fakeWorkerFactory(api: Partial<EngineApi>): {
  factory: () => Worker;
  created: () => number;
} {
  let count = 0;
  return {
    factory: () => {
      count++;
      const { port1, port2 } = new MessageChannel();
      expose(api, port2);
      return Object.assign(port1, {
        terminate: () => {
          port1.close();
          port2.close();
        },
      }) as unknown as Worker;
    },
    created: () => count,
  };
}

describe('engine client', () => {
  it('runs calls in the worker and returns their results', async () => {
    const fake = fakeWorkerFactory({ analyze });
    const client = createEngineClient(fake.factory);
    const r = await client.analyze('k7/8/8/8/8/8/8/K6P w - - 0 1', 1);
    expect(r.ok && r.value.verdict.kind).toBe('illegal');
    client.dispose();
  });

  it('cancels by terminating: calls in flight reject with CancelledError, the next call gets a new worker', async () => {
    const never = (): Promise<never> => new Promise(() => undefined);
    const fake = fakeWorkerFactory({
      analyze: never as unknown as EngineApi['analyze'],
      lastMoves: never as unknown as EngineApi['lastMoves'],
    });
    const client = createEngineClient(fake.factory);
    const pending = client.analyze('8/8/8/8/8/8/8/K6k w - - 0 1', 1);
    expect(client.busy()).toBe(true);
    client.cancel();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(client.busy()).toBe(false);

    const again = client.lastMoves('8/8/8/8/8/8/8/K6k w - - 0 1', 1);
    expect(fake.created()).toBe(2);
    client.cancel();
    await expect(again).rejects.toBeInstanceOf(CancelledError);
  });
});
