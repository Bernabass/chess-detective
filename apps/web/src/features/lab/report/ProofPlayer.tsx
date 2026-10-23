import { START_FEN } from '@retrograde/engine';
import { useMemo, useState } from 'react';
import { Board } from '../../../components/Board';
import { Icon, type IconName } from '../../../components/Icon';
import { proofSteps } from '../../../lib/notation';

function StepButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-card-edge bg-card p-2 text-ink transition hover:bg-paper disabled:opacity-40"
    >
      <Icon name={icon} className="h-4 w-4" title={label} />
    </button>
  );
}

/**
 * Plays a proof game back step by step (SPEC §9.2): a board, a scrubber (a range input, so arrow
 * keys work), first/previous/next/last buttons and the clickable move list.
 */
export function ProofPlayer({ proof, title }: { proof: readonly string[]; title: string }) {
  const steps = useMemo(() => proofSteps(proof), [proof]);
  const [ply, setPly] = useState(steps.length);
  const step = ply === 0 ? null : steps[ply - 1];
  const fen = step?.fen ?? START_FEN;
  const lastMove =
    step === null || step === undefined
      ? null
      : ([step.uci.slice(0, 2), step.uci.slice(2, 4)] as const);
  const go = (n: number): void => {
    setPly(Math.max(0, Math.min(steps.length, n)));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr]">
      <div className="mx-auto w-full max-w-60">
        <Board
          fen={fen}
          lastMove={lastMove}
          label={`${title}, after ${String(ply)} plies`}
          coordinates={false}
        />
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-sm text-ink-soft" aria-live="polite">
          {ply === 0 ? 'Starting position' : `After ${step?.label ?? ''}`} · ply {ply} of{' '}
          {steps.length}
        </p>
        <div className="flex items-center gap-1.5">
          <StepButton
            icon="first"
            label="Start"
            onClick={() => {
              go(0);
            }}
            disabled={ply === 0}
          />
          <StepButton
            icon="prev"
            label="Previous move"
            onClick={() => {
              go(ply - 1);
            }}
            disabled={ply === 0}
          />
          <input
            type="range"
            min={0}
            max={steps.length}
            value={ply}
            onChange={(e) => {
              go(Number(e.target.value));
            }}
            aria-label="Proof game position"
            aria-valuetext={ply === 0 ? 'Starting position' : `After ${step?.label ?? ''}`}
            className="mx-1 min-w-0 flex-1 accent-accent"
          />
          <StepButton
            icon="next"
            label="Next move"
            onClick={() => {
              go(ply + 1);
            }}
            disabled={ply === steps.length}
          />
          <StepButton
            icon="last"
            label="End"
            onClick={() => {
              go(steps.length);
            }}
            disabled={ply === steps.length}
          />
        </div>
        <ol className="mt-3 flex flex-wrap gap-1 font-mono text-sm" aria-label="Proof game moves">
          {steps.map((s, i) => (
            <li key={`${String(i)}-${s.uci}`}>
              <button
                type="button"
                onClick={() => {
                  go(i + 1);
                }}
                aria-current={ply === i + 1 ? 'step' : undefined}
                className={`rounded px-1.5 py-0.5 ${
                  ply === i + 1 ? 'bg-accent text-accent-ink' : 'hover:bg-card-edge/60'
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
