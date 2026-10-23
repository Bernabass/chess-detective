import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDto, EngineResult, ProveDto, ProveProgress } from '../../worker/api';
import { CancelledError, type EngineClient } from '../../worker/client';
import { ANALYSIS_DEBOUNCE_MS, useAnalysis, useProver } from './useEngine';

interface Call<T> {
  fen: string;
  resolve: (v: T) => void;
  onProgress?: (p: ProveProgress) => void;
}

/** A controllable engine client: calls stay pending until the test resolves them. */
const fake = {
  analyses: [] as Call<EngineResult<AnalysisDto>>[],
  proofs: [] as Call<EngineResult<ProveDto>>[],
  cancels: 0,
  rejecters: new Set<(e: Error) => void>(),
};

function pending<T>(
  list: Call<T>[],
  fen: string,
  onProgress?: (p: ProveProgress) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const rejecter = (e: Error): void => {
      reject(e);
    };
    fake.rejecters.add(rejecter);
    list.push({
      fen,
      resolve: (v) => {
        fake.rejecters.delete(rejecter);
        resolve(v);
      },
      ...(onProgress === undefined ? {} : { onProgress }),
    });
  });
}

vi.mock('../../worker/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../worker/client')>();
  return {
    ...original,
    createEngineClient: (): EngineClient => ({
      analyze: (fen) => pending(fake.analyses, fen),
      lastMoves: () => Promise.reject(new Error('unused')),
      prove: (fen, _max, onProgress) => pending(fake.proofs, fen, onProgress),
      cancel: () => {
        fake.cancels++;
        for (const reject of fake.rejecters) reject(new CancelledError());
        fake.rejecters.clear();
      },
      busy: () => fake.rejecters.size > 0,
      dispose: () => undefined,
    }),
  };
});

afterEach(() => {
  fake.analyses = [];
  fake.proofs = [];
  fake.cancels = 0;
  fake.rejecters.clear();
  vi.useRealTimers();
});

const proof = (solution: string[] | null): EngineResult<ProveDto> => ({
  ok: true,
  value: { status: 'complete', solution, nodes: 10, elapsedMs: 1, minimumPlies: 2, maxPlies: 16 },
});

const analysis = (kind: 'legal' | 'illegal'): EngineResult<AnalysisDto> => ({
  ok: true,
  value: {
    verdict: kind === 'legal' ? { kind, proof: [], findings: [] } : { kind, findings: [] },
    lastMoves: { moves: [], depth: 3, status: 'complete', nodes: 0, elapsedMs: 0 },
    elapsedMs: 1,
  },
});

describe('useProver', () => {
  it('leaving a position mid-search stops it, and coming back shows idle, not "Searching…"', () => {
    const { result, rerender } = renderHook(({ fen }) => useProver(fen), {
      initialProps: { fen: 'A' },
    });
    act(() => {
      result.current.start();
    });
    expect(result.current.state.status).toBe('running');

    rerender({ fen: 'B' });
    expect(result.current.state.status).toBe('idle');
    expect(fake.cancels).toBeGreaterThan(0);

    rerender({ fen: 'A' });
    expect(result.current.state.status).toBe('idle');
  });

  it('ignores progress that arrives after Cancel', async () => {
    const { result } = renderHook(() => useProver('A'));
    act(() => {
      result.current.start();
    });
    const call = fake.proofs[0];
    act(() => {
      call?.onProgress?.({ plies: 8, nodes: 1000, elapsedMs: 5 });
    });
    expect(result.current.state).toMatchObject({ status: 'running', progress: { plies: 8 } });

    await act(async () => {
      result.current.cancel();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('cancelled');
    act(() => {
      call?.onProgress?.({ plies: 10, nodes: 2000, elapsedMs: 9 });
    });
    expect(result.current.state.status).toBe('cancelled');
  });

  it('keeps a finished proof for its position', async () => {
    const { result, rerender } = renderHook(({ fen }) => useProver(fen), {
      initialProps: { fen: 'A' },
    });
    act(() => {
      result.current.start();
    });
    await act(async () => {
      fake.proofs[0]?.resolve(proof(['e2e4']));
      await Promise.resolve();
    });
    expect(result.current.state).toMatchObject({ status: 'done' });
    rerender({ fen: 'A' });
    expect(result.current.state).toMatchObject({ status: 'done' });
    rerender({ fen: 'B' });
    expect(result.current.state.status).toBe('idle');
  });
});

describe('useAnalysis', () => {
  it('debounces, and never reports an older position as the current result', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ fen }) => useAnalysis(fen, 3), {
      initialProps: { fen: 'A' },
    });
    expect(result.current.status).toBe('running');
    expect(fake.analyses).toHaveLength(0); // debounced
    act(() => {
      vi.advanceTimersByTime(ANALYSIS_DEBOUNCE_MS);
    });
    expect(fake.analyses.map((c) => c.fen)).toEqual(['A']);
    await act(async () => {
      fake.analyses[0]?.resolve(analysis('legal'));
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ status: 'done' });

    rerender({ fen: 'B' });
    // A's result is only "previous" now.
    expect(result.current).toMatchObject({
      status: 'running',
      previous: { verdict: { kind: 'legal' } },
    });
    act(() => {
      vi.advanceTimersByTime(ANALYSIS_DEBOUNCE_MS);
    });
    await act(async () => {
      fake.analyses[1]?.resolve(analysis('illegal'));
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({
      status: 'done',
      result: { verdict: { kind: 'illegal' } },
    });
  });
});
