import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from 'react';
import { Board, type BoardHandle } from '../../components/Board';
import { Icon } from '../../components/Icon';
import { PieceIcon, type PieceRole } from '../../components/PieceIcon';
import { Button } from '../../components/ui';
import { keepEllipsis } from '../../lib/notation';
import { DOT, ELLIPSIS } from './format';
import {
  boardState,
  differences,
  parseTypedMove,
  type MovesAction,
  type MovesState,
} from './moves';

const PROMOTIONS: { letter: string; role: PieceRole }[] = [
  { letter: 'q', role: 'queen' },
  { letter: 'r', role: 'rook' },
  { letter: 'b', role: 'bishop' },
  { letter: 'n', role: 'knight' },
];

/** Picks the piece a pawn promotes to (SPEC §8.2). Escape or Cancel takes the move back. */
function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: 'white' | 'black';
  onPick: (letter: string) => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.focus();
    // Escape cancels wherever focus is, like a modal dialog.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);
  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-labelledby="promotion-title"
      className="absolute inset-0 z-20 grid place-items-center bg-black/45 p-3"
      onKeyDown={(e) => {
        // Tab cycles inside the picker.
        if (e.key !== 'Tab') return;
        const items = Array.from(box.current?.querySelectorAll('button') ?? []);
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = (at + (e.shiftKey ? items.length - 1 : 1)) % items.length;
        e.preventDefault();
        items[next]?.focus();
      }}
    >
      <div className="rounded-lg border border-card-edge bg-card p-3 shadow-card">
        <p id="promotion-title" className="mb-2 text-center font-medium">
          Promote to
        </p>
        <div className="grid grid-cols-4 gap-2">
          {PROMOTIONS.map((p, i) => (
            <button
              key={p.letter}
              ref={i === 0 ? first : undefined}
              type="button"
              aria-label={p.role}
              onClick={() => {
                onPick(p.letter);
              }}
              className="h-14 w-14 rounded-md border border-card-edge bg-paper p-1 hover:bg-card-edge/60"
            >
              <PieceIcon role={p.role} color={color} />
            </button>
          ))}
        </div>
        <Button variant="ghost" className="mt-2 w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Typing a move: the keyboard alternative to the board (SPEC §11.4). */
function MoveInput({
  moves,
  disabled,
  onMove,
  inputRef,
}: {
  moves: readonly string[];
  disabled: boolean;
  onMove: (uci: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const r = parseTypedMove(moves, text);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        setText('');
        onMove(r.uci);
      }}
    >
      <label htmlFor={id} className="sr-only">
        Type a move
      </label>
      <input
        ref={inputRef}
        id={id}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder="Type a move: e4, Nf3"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${id}-error`}
        className="min-w-0 flex-1 rounded-md border border-card-edge bg-paper px-3 py-2 font-mono text-sm text-ink disabled:opacity-50"
      />
      <Button type="submit" disabled={disabled}>
        Play
      </Button>
      {error !== null && (
        <p id={`${id}-error`} role="alert" className="w-full text-sm text-bad">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Where a guess is played (SPEC §8.2): the board with only legal moves, the move list, the ply
 * counter, Undo / Reset / Submit, typed input and the difference overlay.
 */
export function PlayArea({
  plies,
  target,
  state,
  dispatch,
  submitting,
  ready,
  repeated,
  onSubmit,
}: {
  plies: number;
  /** The target key ("placement side"). */
  target: string;
  state: MovesState;
  dispatch: Dispatch<MovesAction>;
  submitting: boolean;
  /** False until the attempt exists (POST /start finished): a guess needs it. */
  ready: boolean;
  /** The guess on the board was already submitted. */
  repeated: boolean;
  onSubmit: () => void;
}) {
  const board = useRef<BoardHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const s = useMemo(() => boardState(state.moves, plies), [state.moves, plies]);
  const [showDiff, setShowDiff] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const cancelPromotion = useCallback(() => {
    setPromotion(null);
    board.current?.sync();
    input.current?.focus();
  }, []);
  const targetPlacement = target.split(' ')[0] ?? '';
  const marks = useMemo(
    () => (showDiff ? differences(s.fen.split(' ')[0] ?? '', targetPlacement) : []),
    [showDiff, s.fen, targetPlacement],
  );

  const played = state.moves.length;
  const moveNumber = Math.floor(played / 2) + 1;
  const status = s.complete
    ? `All ${String(plies)} plies played${repeated ? `: you already tried this game` : ': submit your guess'}`
    : `Move ${String(moveNumber)}, ${s.turnColor === 'white' ? 'White' : 'Black'} to play`;

  return (
    <div>
      <div className="relative mx-auto" style={{ maxWidth: 'min(100%, calc(100dvh - 9rem))' }}>
        <Board
          ref={board}
          fen={s.fen}
          label="Your game"
          lastMove={s.lastMove}
          marks={marks}
          play={{
            turnColor: s.turnColor,
            dests: s.dests,
            check: s.check,
            onMove: (from, to) => {
              if (s.needsPromotion(from, to)) setPromotion({ from, to });
              else dispatch({ type: 'play', uci: from + to });
            },
          }}
        />
        {promotion !== null && (
          <PromotionPicker
            color={s.turnColor}
            onPick={(letter) => {
              dispatch({ type: 'play', uci: promotion.from + promotion.to + letter });
              setPromotion(null);
              input.current?.focus();
            }}
            onCancel={cancelPromotion}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          <span className="font-mono font-medium" data-testid="ply-counter">
            {played} / {plies}
          </span>{' '}
          <span className="text-ink-soft">
            plies {DOT} {status}
          </span>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => {
              setShowDiff(e.target.checked);
            }}
            className="h-4 w-4 accent-[var(--focus)]"
          />
          Show differences from the target
        </label>
      </div>

      <ol
        aria-label="Your moves"
        className="mt-2 flex min-h-8 flex-wrap gap-x-2 gap-y-1 font-mono text-sm"
      >
        {s.steps.length === 0 && <li className="text-ink-soft">No moves yet.</li>}
        {s.steps.map((step, i) => (
          <li key={i}>{keepEllipsis(step.label)}</li>
        ))}
      </ol>

      <div className="mt-3">
        <MoveInput
          inputRef={input}
          moves={state.moves}
          disabled={s.complete}
          onMove={(uci) => {
            dispatch({ type: 'play', uci });
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            dispatch({ type: 'undo' });
          }}
          disabled={played === 0}
        >
          <Icon name="undo" className="h-4 w-4" />
          Undo
        </Button>
        <Button
          onClick={() => {
            dispatch({ type: 'reset' });
          }}
          disabled={played === 0}
        >
          Reset
        </Button>
        <Button
          variant="primary"
          className="ml-auto"
          onClick={onSubmit}
          disabled={!s.complete || !ready || submitting || repeated}
        >
          <Icon name="check" className="h-4 w-4" />
          {submitting ? `Checking${ELLIPSIS}` : 'Submit guess'}
        </Button>
      </div>
    </div>
  );
}
