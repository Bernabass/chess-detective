import { useId, useState } from 'react';
import { fromFen, parseError, toFenString, type LabFields } from '../labState';

/**
 * The FEN input (SPEC §9.1), also the keyboard path to full editing. A valid FEN applies as soon
 * as it's typed or pasted (missing trailing fields default to "w - -"); an invalid one shows the
 * engine's reason inline and leaves the position unchanged.
 */
export function FenField({ fen, onChange }: { fen: string; onChange: (f: LabFields) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(fen);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(fen);

  // Follow outside changes (board edits, examples), but don't rewrite what the user is typing
  // when it already describes this position (e.g. a FEN without its trailing fields). Adjusting
  // state during render is React's pattern for "reset when a prop changes".
  if (fen !== shown) {
    setShown(fen);
    const typed = fromFen(draft);
    if (typed === null || toFenString(typed) !== fen) setDraft(fen);
    setError(null);
  }

  const update = (text: string): void => {
    setDraft(text);
    const problem = parseError(text);
    setError(problem);
    const fields = problem === null ? fromFen(text) : null;
    if (fields !== null) onChange(fields);
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        FEN
      </label>
      <input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${id}-error`}
        onChange={(e) => {
          update(e.target.value);
        }}
        onFocus={(e) => {
          e.target.select();
        }}
        className={`w-full rounded-md border bg-paper px-3 py-2 font-mono text-sm ${
          error === null ? 'border-card-edge' : 'border-bad'
        }`}
      />
      <p id={`${id}-error`} aria-live="polite" className="mt-1 text-sm text-bad empty:hidden">
        {error ?? ''}
      </p>
    </div>
  );
}
