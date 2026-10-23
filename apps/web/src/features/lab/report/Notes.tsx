import type { Finding } from '@retrograde/engine';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { keepEllipsis } from '../../../lib/notation';
import { groupFindings, type Highlight, type NoteGroup } from './findings';

/**
 * Detective notes (SPEC §9.2). Hovering or focusing a note highlights its squares and arrows on
 * the board; clicking (or tapping) pins the highlight until clicked again.
 */
export function Notes({
  findings,
  onHighlight,
}: {
  findings: readonly Finding[];
  onHighlight: (h: Highlight | null) => void;
}) {
  const groups = groupFindings(findings);
  const [pinned, setPinned] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <p className="text-ink-soft">
        No notes: nothing about this position's history stands out yet.
      </p>
    );
  }

  const show = (g: NoteGroup): void => {
    onHighlight({ squares: g.squares, arrows: g.arrows });
  };
  const clear = (): void => {
    const p = groups.find((g) => g.rule === pinned);
    onHighlight(p === undefined ? null : { squares: p.squares, arrows: p.arrows });
  };

  return (
    <ul className="space-y-2">
      {groups.map((g) => {
        const contradiction = g.severity === 'illegal';
        const isPinned = pinned === g.rule;
        const canHighlight = g.squares.length > 0 || g.arrows.length > 0;
        return (
          <li key={g.rule}>
            <button
              type="button"
              aria-pressed={canHighlight ? isPinned : undefined}
              onMouseEnter={() => {
                show(g);
              }}
              onFocus={() => {
                show(g);
              }}
              onMouseLeave={clear}
              onBlur={clear}
              onClick={() => {
                const next = isPinned ? null : g.rule;
                setPinned(next);
                onHighlight(next === null ? null : { squares: g.squares, arrows: g.arrows });
              }}
              className={`w-full rounded-md border px-3 py-2 text-left transition ${
                isPinned ? 'border-accent bg-paper' : 'border-card-edge hover:border-accent/60'
              }`}
            >
              <span
                className={`mb-1 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold tracking-wide uppercase ${
                  contradiction ? 'text-bad' : 'text-brass'
                }`}
              >
                <Icon name={contradiction ? 'cross' : 'search'} className="h-3.5 w-3.5" />
                {contradiction ? 'Contradiction' : 'Deduction'}
                <span className="ml-auto min-w-0 font-mono text-[10px] font-normal tracking-normal break-all text-ink-soft normal-case">
                  {g.rule}
                </span>
              </span>
              {g.messages.map((m) => (
                <span key={m} className="block text-sm text-ink">
                  {keepEllipsis(m)}
                </span>
              ))}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
