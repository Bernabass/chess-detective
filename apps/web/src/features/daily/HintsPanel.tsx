import type { Hint } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';

const MAX_HINTS = 3;
const NAMES = ['Which pieces moved', 'Where the captures are', 'One move of the solution'];

/** The three hints (SPEC §8.4), taken one at a time; each one counts against the ranking. */
export function HintsPanel({
  hints,
  canTake,
  taking,
  error,
  onTake,
}: {
  hints: readonly Hint[];
  /** False when the attempt is over or not started. */
  canTake: boolean;
  taking: boolean;
  error: string | null;
  onTake: () => void;
}) {
  const next = hints.length + 1;
  return (
    <div>
      {hints.length > 0 && (
        <ol className="mb-3 space-y-2">
          {hints.map((h, i) => (
            <li
              key={h.kind}
              className="flex gap-2 rounded-md border border-card-edge bg-paper px-3 py-2"
            >
              <Icon name="bulb" className="mt-0.5 h-4 w-4 text-brass" />
              <div>
                <p className="text-xs font-semibold tracking-wide text-brass uppercase">
                  Hint {i + 1}: {NAMES[i]}
                </p>
                <p data-testid={`hint-${String(i + 1)}`}>{h.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {hints.length < MAX_HINTS && canTake && (
        <>
          <Button onClick={onTake} disabled={taking}>
            <Icon name="bulb" className="h-4 w-4" />
            Take hint {next} of {MAX_HINTS}: {NAMES[next - 1]?.toLowerCase()}
          </Button>
          <p className="mt-1 text-xs text-ink-soft">Each hint counts against your ranking.</p>
        </>
      )}
      {hints.length === 0 && !canTake && <p className="text-sm text-ink-soft">No hints taken.</p>}
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
