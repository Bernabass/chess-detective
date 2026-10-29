import { Icon } from '../../components/Icon';
import { keepEllipsis, type ProofStep } from '../../lib/notation';
import { FEEDBACK } from './feedbackKinds';

function kindOf(c: string): 'G' | 'Y' | 'X' {
  return c === 'G' || c === 'Y' ? c : 'X';
}

/** One feedback square. */
export function FeedbackCell({ kind, size = 'md' }: { kind: 'G' | 'Y' | 'X'; size?: 'sm' | 'md' }) {
  const f = FEEDBACK[kind];
  return (
    <span
      aria-hidden="true"
      data-feedback={kind}
      className={`grid aspect-square place-items-center rounded-[3px] ${f.className} ${
        size === 'sm' ? 'w-7' : 'w-full'
      }`}
    >
      <Icon
        name={f.icon}
        className={size === 'sm' ? 'h-4 w-4' : 'h-[55%] w-[55%] min-h-3 min-w-3'}
      />
    </span>
  );
}

/**
 * A guess as a row of feedback squares with its moves underneath. Its accessible text reads
 * every ply: "Ply 1, Nf3: not in the solution. Ply 2, e5: right move, right ply. …"
 */
export function FeedbackRow({
  feedback,
  steps,
  label,
}: {
  feedback: string;
  steps: readonly ProofStep[];
  label: string;
}) {
  const cells = Array.from(feedback).map(kindOf);
  const spoken = cells
    .map((k, i) => `Ply ${String(i + 1)}, ${steps[i]?.san ?? '?'}: ${FEEDBACK[k].label}.`)
    .join(' ');
  return (
    <div className="min-w-0">
      <span className="sr-only">
        {label}. {spoken}
      </span>
      <div
        aria-hidden="true"
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${String(cells.length)}, minmax(0, 1fr))` }}
      >
        {cells.map((k, i) => (
          <FeedbackCell key={i} kind={k} />
        ))}
      </div>
      <p
        aria-hidden="true"
        className="mt-1 font-mono text-xs leading-snug break-words text-ink-soft"
      >
        {keepEllipsis(steps.map((s) => s.label).join(' '))}
      </p>
    </div>
  );
}
