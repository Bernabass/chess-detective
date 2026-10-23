import type { LastMove, LastMovesResult, Viability } from '@retrograde/engine';
import { Icon, type IconName } from '../../../components/Icon';
import { Button } from '../../../components/ui';
import { keepEllipsis } from '../../../lib/notation';

const VIABILITY: Record<Viability, { word: string; icon: IconName; tone: string }> = {
  viable: { word: 'Possible', icon: 'check', tone: 'text-ok' },
  'not-viable': { word: 'Impossible', icon: 'cross', tone: 'text-bad' },
  unknown: { word: 'Unknown', icon: 'question', tone: 'text-warn' },
};

const DEPTHS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Possible last moves (SPEC §9.2): every depth-1 retraction with its viability at the chosen
 * depth, each with "Take it back" to load the position before it.
 */
export function LastMoves({
  result,
  depth,
  onDepth,
  onTakeBack,
  onPreview,
}: {
  result: LastMovesResult;
  depth: number;
  onDepth: (depth: number) => void;
  onTakeBack: (move: LastMove) => void;
  /** Hovering a move shows it as an arrow on the board. */
  onPreview: (move: LastMove | null) => void;
}) {
  const possible = result.moves.filter((m) => m.viability === 'viable').length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span>Check</span>
          <select
            value={depth}
            onChange={(e) => {
              onDepth(Number(e.target.value));
            }}
            className="rounded-md border border-card-edge bg-paper px-2 py-1"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'move' : 'moves'} back
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-ink-soft">
          {result.moves.length === 0
            ? 'No move could have led here.'
            : `${String(possible)} of ${String(result.moves.length)} possible`}
        </p>
      </div>
      {result.status !== 'complete' && (
        <p className="mb-2 text-sm text-warn">
          The search hit its time limit, so some answers are unknown. Try fewer moves back.
        </p>
      )}
      <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {result.moves.map((m) => {
          const v = VIABILITY[m.viability];
          return (
            <li
              key={`${m.move}-${m.kind}-${m.uncaptured ?? ''}`}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-card-edge px-3 py-2"
              onMouseEnter={() => {
                onPreview(m);
              }}
              onMouseLeave={() => {
                onPreview(null);
              }}
            >
              <span className="min-w-0 flex-1 basis-48 text-sm">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${v.tone}`}
                  >
                    <Icon name={v.icon} className="h-4 w-4" />
                    {v.word}
                  </span>
                  <span className="font-mono font-medium">{keepEllipsis(m.notation)}</span>
                </span>
                <span className="block text-ink-soft">{keepEllipsis(m.description)}</span>
              </span>
              <Button
                className="ml-auto shrink-0 px-2 py-1 text-xs"
                onClick={() => {
                  onTakeBack(m);
                }}
                onFocus={() => {
                  onPreview(m);
                }}
                onBlur={() => {
                  onPreview(null);
                }}
                aria-label={`Take back ${m.notation}`}
              >
                <Icon name="undo" className="h-3.5 w-3.5" />
                Take it back
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
