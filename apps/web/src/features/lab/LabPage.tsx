import type { LastMove } from '@retrograde/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Board, type BoardHandle } from '../../components/Board';
import { Icon } from '../../components/Icon';
import { Button, Card, Eyebrow, PageTitle } from '../../components/ui';
import { useTitle } from '../../lib/useTitle';
import { FenField } from './editor/FenField';
import { Palette } from './editor/Palette';
import type { Armed } from './editor/pieces';
import { PositionFields } from './editor/PositionFields';
import { SquareOverlay } from './editor/SquareOverlay';
import { ExampleGallery } from './ExampleGallery';
import {
  EMPTY,
  START,
  fromFen,
  labPath,
  lichessEditorUrl,
  toFenString,
  type LabFields,
} from './labState';
import { LastMoves } from './report/LastMoves';
import type { Highlight } from './report/findings';
import { Notes } from './report/Notes';
import { ProofPlayer } from './report/ProofPlayer';
import { Prove } from './report/Prove';
import { VerdictBanner } from './report/VerdictBanner';
import { useAnalysis, useProver } from './useEngine';

/** The Lab (SPEC §9): edit or paste a position, read the engine's deductions, prove it. */
export function LabPage() {
  useTitle('Lab');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const fenParam = params.get('fen');
  const parsed = fenParam === null ? START : fromFen(fenParam);
  const badLink = fenParam !== null && parsed === null;
  const fields = parsed ?? START;
  const fen = toFenString(fields);

  /** Edits replace the history entry; take-backs and examples push a new one (Back undoes them). */
  const setFields = useCallback(
    (next: LabFields, push = false) => {
      if (push) {
        void navigate(labPath(next));
      } else {
        setParams({ fen: toFenString(next) }, { replace: true });
      }
    },
    [navigate, setParams],
  );

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [depth, setDepth] = useState(3);
  const [armed, setArmed] = useState<Armed>(null);
  // Board highlights from a hovered note or last move, tied to the position they were made for:
  // after any change of position they no longer apply.
  const [highlightFor, setHighlightFor] = useState<{ fen: string; h: Highlight | null } | null>(
    null,
  );
  const [previewFor, setPreviewFor] = useState<{ fen: string; move: LastMove | null } | null>(null);
  const highlight = highlightFor?.fen === fen ? highlightFor.h : null;
  const preview = previewFor?.fen === fen ? previewFor.move : null;
  const setHighlight = useCallback(
    (h: Highlight | null) => {
      setHighlightFor({ fen, h });
    },
    [fen],
  );
  const setPreview = useCallback(
    (move: LastMove | null) => {
      setPreviewFor({ fen, move });
    },
    [fen],
  );
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const board = useRef<BoardHandle>(null);

  const analysis = useAnalysis(fen, depth);
  const prover = useProver(fen);

  // Escape leaves click-to-place mode from anywhere on the page.
  useEffect(() => {
    if (armed === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      document.querySelector<HTMLElement>('[data-palette][aria-pressed="true"]')?.focus();
      setArmed(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [armed]);

  const result =
    analysis.status === 'done'
      ? analysis.result
      : analysis.status === 'running'
        ? analysis.previous
        : null;
  const busy = analysis.status === 'running';

  const onBoardEdit = useCallback(
    (placement: string) => {
      if (placement !== fields.placement) setFields({ ...fields, placement });
    },
    [fields, setFields],
  );

  const placeOn = (square: string): void => {
    if (armed === null) return;
    board.current?.setPiece(
      square,
      armed === 'eraser' ? null : { role: armed.role, color: armed.color },
    );
  };

  const arrows = useMemo((): [string, string][] => {
    if (preview !== null) return [[preview.move.slice(0, 2), preview.move.slice(2, 4)]];
    return highlight?.arrows ?? [];
  }, [preview, highlight]);

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLink = (): void => {
    const url = new URL(labPath(fields), window.location.origin).toString();
    const show = (state: 'copied' | 'failed'): void => {
      setCopied(state);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied('idle');
      }, 2500);
    };
    // navigator.clipboard only exists on secure origins (https, localhost).
    if (!('clipboard' in navigator)) {
      show('failed');
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => {
        show('copied');
      },
      () => {
        show('failed');
      },
    );
  };

  const verdict = result?.verdict ?? null;

  return (
    <>
      <PageTitle lead="Set up or paste any position. The engine works out what it can about how it arose: whether it's legal, which moves could have come last, and a game that reaches it.">
        The Lab
      </PageTitle>

      {badLink && (
        <p role="alert" className="mb-4 rounded-md border border-bad px-3 py-2 text-sm text-bad">
          The link's position isn't a valid FEN, so the Lab shows the starting position instead.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card labelledBy="board-heading">
            <h2 id="board-heading" className="sr-only">
              Board editor
            </h2>
            <div className="relative">
              <Board
                ref={board}
                fen={fields.placement}
                orientation={orientation}
                editable
                onEdit={onBoardEdit}
                highlights={highlight?.squares ?? []}
                arrows={arrows}
                label="Lab board (drag pieces to edit, or use the FEN field)"
              />
              {armed !== null && (
                <SquareOverlay armed={armed} orientation={orientation} onSquare={placeOn} />
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setFields(START, true);
                }}
              >
                Start position
              </Button>
              <Button
                onClick={() => {
                  setFields(EMPTY, true);
                }}
              >
                Clear
              </Button>
              <Button
                onClick={() => {
                  setOrientation((o) => (o === 'white' ? 'black' : 'white'));
                }}
              >
                <Icon name="flip" className="h-4 w-4" />
                Flip
              </Button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm text-ink-soft">
                {armed === null
                  ? 'Drag a piece onto the board, or click one to place it by clicking squares. Drag pieces off the board to remove them.'
                  : `Click squares to ${armed === 'eraser' ? 'clear them' : 'place the piece'}. Press Escape or click the piece again to stop.`}
              </p>
              <Palette
                armed={armed}
                onArm={setArmed}
                onDragStart={(item, event) => {
                  board.current?.dragNewPiece({ role: item.role, color: item.color }, event);
                }}
              />
            </div>
          </Card>

          <Card labelledBy="position-heading">
            <Eyebrow id="position-heading">Position</Eyebrow>
            <div className="space-y-4">
              <FenField
                fen={fen}
                onChange={(f) => {
                  setFields(f);
                }}
              />
              <PositionFields
                fields={fields}
                onChange={(f) => {
                  setFields(f);
                }}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
                <Button onClick={copyLink}>
                  <Icon name="link" className="h-4 w-4" />
                  Copy link
                </Button>
                <a
                  href={lichessEditorUrl(fields)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-card-edge bg-card px-3 py-2 text-sm font-medium text-ink no-underline transition hover:bg-paper"
                >
                  <Icon name="external" className="h-4 w-4" />
                  Open in Lichess
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <span aria-live="polite" className="text-sm text-ink-soft">
                  {copied === 'copied'
                    ? 'Link copied.'
                    : copied === 'failed'
                      ? "Couldn't copy: copy the address bar instead."
                      : ''}
                </span>
              </div>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card labelledBy="verdict-heading">
            <Eyebrow id="verdict-heading">Verdict</Eyebrow>
            <div aria-live="polite" aria-busy={busy}>
              {verdict === null ? (
                <p className="text-ink-soft">
                  {analysis.status === 'error' ? analysis.message : 'Analyzing…'}
                </p>
              ) : (
                <VerdictBanner verdict={verdict} busy={busy} />
              )}
              {busy && verdict !== null && <p className="mt-2 text-sm text-ink-soft">Analyzing…</p>}
            </div>
          </Card>

          {result !== null && (
            // While a new analysis runs, the old report belongs to another position: dimmed and
            // inert, so nothing in it (take-backs, notes, the proof) can be used by mistake.
            <div
              className={`space-y-4 transition-opacity ${busy ? 'opacity-50' : ''}`}
              inert={busy}
              aria-busy={busy}
            >
              <Card labelledBy="notes-heading">
                <Eyebrow id="notes-heading">Detective notes</Eyebrow>
                <Notes key={fen} findings={result.verdict.findings} onHighlight={setHighlight} />
              </Card>

              <Card labelledBy="last-heading">
                <Eyebrow id="last-heading">Possible last moves</Eyebrow>
                <LastMoves
                  result={result.lastMoves}
                  depth={depth}
                  onDepth={setDepth}
                  onPreview={setPreview}
                  onTakeBack={(m) => {
                    const prior = fromFen(m.prior);
                    if (prior !== null) setFields(prior, true);
                  }}
                />
              </Card>

              <Card labelledBy="prove-heading">
                <Eyebrow id="prove-heading">
                  {result.verdict.kind === 'legal' ? 'Shortest proof game' : 'Prove it'}
                </Eyebrow>
                {result.verdict.kind === 'legal' ? (
                  result.verdict.proof.length === 0 ? (
                    <p className="text-sm text-ink-soft">The starting position needs no moves.</p>
                  ) : (
                    <ProofPlayer
                      key={result.verdict.proof.join(' ')}
                      proof={result.verdict.proof}
                      title="Shortest proof game"
                    />
                  )
                ) : (
                  <Prove state={prover.state} onStart={prover.start} onCancel={prover.cancel} />
                )}
              </Card>
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="examples-heading" className="mt-10">
        <h2 id="examples-heading" className="mb-1 text-2xl font-semibold">
          Cases to crack
        </h2>
        <p className="mb-4 text-ink-soft">
          Ten positions with a story to tell. Open one and read the notes.
        </p>
        <ExampleGallery />
      </section>
    </>
  );
}
