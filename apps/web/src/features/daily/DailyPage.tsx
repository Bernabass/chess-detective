import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Puzzle } from '../../api/types';
import { Board } from '../../components/Board';
import { Icon } from '../../components/Icon';
import { Button, ButtonLink, Card, Eyebrow } from '../../components/ui';
import { proofSteps } from '../../lib/notation';
import { ApiError, errorMessage } from '../../lib/problem';
import {
  keys,
  useMe,
  usePuzzle,
  useStartPuzzle,
  useSubmitGuess,
  useTakeHint,
} from '../../lib/queries';
import { useTitle } from '../../lib/useTitle';
import { FeedbackRow } from './Feedback';
import { summarize } from './feedbackKinds';
import { ELLIPSIS, lengthLabel, stars } from './format';
import { HintsPanel } from './HintsPanel';
import { hasSeenHowToPlay } from './howto';
import { HowToPlay } from './HowToPlay';
import { movesReducer } from './moves';
import { PlayArea } from './PlayArea';
import { ResultPanel } from './ResultPanel';

const MAX_GUESSES = 6;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** /daily and /daily/:number: the Daily Proof Game (SPEC §8). */
export function DailyPage() {
  const { number: param } = useParams();
  const number = param === undefined ? undefined : Number(param);
  const valid = number === undefined || (Number.isInteger(number) && number >= 1);
  const puzzle = usePuzzle(number, valid);
  const [howTo, setHowTo] = useState(() => !hasSeenHowToPlay());

  const shown = puzzle.data?.number ?? (valid ? number : undefined);
  const name = shown === undefined ? 'Daily proof game' : `Retrograde #${String(shown)}`;
  useTitle(name);

  const header = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="mb-1 font-sans text-xs font-semibold tracking-[0.14em] text-brass uppercase">
          {puzzle.data === undefined ? 'Daily proof game' : formatDay(puzzle.data.day)}
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">{name}</h1>
        {puzzle.data !== undefined && (
          <p className="mt-1 text-ink-soft">
            <span
              role="img"
              aria-label={`Difficulty ${String(puzzle.data.difficulty)} of 5`}
              className="text-brass"
            >
              {stars(puzzle.data.difficulty)}
            </span>{' '}
            Reach the target in{' '}
            <span className="whitespace-nowrap">{lengthLabel(puzzle.data.plies)}</span>
          </p>
        )}
      </div>
      <Button
        onClick={() => {
          setHowTo(true);
        }}
      >
        <Icon name="question" className="h-4 w-4" />
        How to play
      </Button>
    </div>
  );

  let body;
  if (!valid) {
    body = <NotFound text="Puzzle numbers start at #1." />;
  } else if (puzzle.isPending) {
    body = <p className="text-ink-soft">Opening the case file{ELLIPSIS}</p>;
  } else if (puzzle.isError) {
    body =
      puzzle.error instanceof ApiError && puzzle.error.status === 404 ? (
        <NotFound
          text={
            number === undefined
              ? "There's no puzzle today yet. Come back soon."
              : `Puzzle #${String(number)} hasn't been released yet.`
          }
        />
      ) : (
        <Card>
          <p role="alert">{errorMessage(puzzle.error)}</p>
          <Button
            className="mt-3"
            onClick={() => {
              void puzzle.refetch();
            }}
          >
            Try again
          </Button>
        </Card>
      );
  } else {
    body = <Game key={puzzle.data.number} puzzle={puzzle.data} />;
  }

  return (
    <>
      {header}
      {body}
      <HowToPlay
        open={howTo}
        onClose={() => {
          setHowTo(false);
        }}
      />
    </>
  );
}

function NotFound({ text }: { text: string }) {
  return (
    <Card className="max-w-xl">
      <p className="font-display text-lg">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ButtonLink to="/daily" variant="primary">
          Today's puzzle
        </ButtonLink>
        <ButtonLink to="/archive">The archive</ButtonLink>
      </div>
    </Card>
  );
}

function Game({ puzzle }: { puzzle: Puzzle }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const start = useStartPuzzle();
  const guess = useSubmitGuess();
  const hint = useTakeHint();
  const [moves, dispatch] = useReducer(movesReducer, { moves: [], max: puzzle.plies });
  const [announcement, setAnnouncement] = useState('');
  const [justFinished, setJustFinished] = useState(false);
  const boardTop = useRef<HTMLDivElement>(null);

  const attempt = puzzle.attempt;
  const finished = attempt !== undefined && attempt.status !== 'in_progress';
  const archive = attempt?.archive ?? puzzle.day < todayUtc();

  // Showing the puzzle starts the attempt (and the guest session): GETs create nothing.
  const started = useRef(false);
  useEffect(() => {
    if (attempt === undefined && !started.current) {
      started.current = true;
      start.mutate(puzzle.number);
    }
  }, [attempt, puzzle.number, start]);

  const guessSteps = useMemo(
    () => (attempt?.guesses ?? []).map((g) => proofSteps(g.moves)),
    [attempt?.guesses],
  );
  const repeated = (attempt?.guesses ?? []).some(
    (g) => g.moves.join(' ') === moves.moves.join(' '),
  );

  const submit = (): void => {
    guess.mutate(
      { number: puzzle.number, moves: moves.moves },
      {
        onSuccess: (r) => {
          const n = r.guessesUsed;
          if (r.status !== 'in_progress') setJustFinished(true);
          setAnnouncement(
            r.status === 'solved'
              ? `Guess ${String(n)} of ${String(MAX_GUESSES)}: solved!`
              : r.status === 'failed'
                ? `Guess ${String(n)} of ${String(MAX_GUESSES)}: ${summarize(r.feedback)}. That was the last guess; the solution is shown below.`
                : `Guess ${String(n)} of ${String(MAX_GUESSES)}: ${summarize(r.feedback)}.`,
          );
        },
      },
    );
  };

  const target = (
    <Card as="div" className="p-3 sm:p-4">
      <Eyebrow>Target position</Eyebrow>
      <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-start gap-3 md:grid-cols-1">
        <Board fen={puzzle.target} label="Target position" coordinates={false} />
        <div className="text-sm">
          <p>
            <strong>{puzzle.target.endsWith(' w') ? 'White' : 'Black'} to move</strong>, after{' '}
            {lengthLabel(puzzle.plies)}.
          </p>
          <p className="mt-1 text-ink-soft">
            Find the game from the starting position that ends here.
          </p>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,34rem)_minmax(16rem,1fr)] lg:grid-cols-[minmax(0,36rem)_minmax(18rem,28rem)]">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="min-w-0 space-y-5">
        {archive && (
          <p className="flex items-center gap-2 rounded-md border border-card-edge bg-card px-3 py-2 text-sm">
            <Icon name="archive" className="h-4 w-4 text-brass" />
            Practice: an archive puzzle. It doesn't count toward your stats, streak or the
            leaderboard.
          </p>
        )}
        <div className="md:hidden">{target}</div>

        {finished ? (
          <Card>
            <ResultPanel
              puzzle={puzzle}
              guest={me.data?.guest}
              currentStreak={me.data?.stats.currentStreak ?? null}
              justFinished={justFinished}
              onNextPuzzle={() => {
                void qc.invalidateQueries({ queryKey: keys.puzzles });
                void navigate('/daily');
              }}
            />
          </Card>
        ) : (
          <Card>
            <div ref={boardTop}>
              <PlayArea
                plies={puzzle.plies}
                target={puzzle.target}
                state={moves}
                dispatch={dispatch}
                submitting={guess.isPending}
                ready={attempt !== undefined}
                repeated={repeated}
                onSubmit={submit}
              />
            </div>
            {guess.error !== null && (
              <p role="alert" className="mt-3 text-sm text-bad">
                {errorMessage(guess.error)}
              </p>
            )}
            {start.error !== null && attempt === undefined && (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-bad">
                <span>Couldn't start the puzzle: {errorMessage(start.error)}</span>
                <Button
                  disabled={start.isPending}
                  onClick={() => {
                    start.mutate(puzzle.number);
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-5">
        <div className="hidden md:block">{target}</div>

        <Card>
          <Eyebrow>
            Guesses {attempt?.guesses.length ?? 0} / {MAX_GUESSES}
          </Eyebrow>
          {(attempt?.guesses.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-soft">
              No guesses yet. Play a whole game of {lengthLabel(puzzle.plies)} on the board and
              submit it.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="Your guesses">
              {(attempt?.guesses ?? []).map((g, i) => {
                const label = `Guess ${String(i + 1)}`;
                const row = (
                  <FeedbackRow feedback={g.feedback} steps={guessSteps[i] ?? []} label={label} />
                );
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1 w-4 shrink-0 text-right font-mono text-xs text-ink-soft"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    {finished ? (
                      <div className="min-w-0 flex-1">{row}</div>
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded text-left hover:bg-card-edge/40"
                        onClick={() => {
                          dispatch({ type: 'load', moves: g.moves });
                          boardTop.current?.scrollIntoView({
                            block: 'nearest',
                            behavior: 'smooth',
                          });
                        }}
                      >
                        {row}
                        <span className="sr-only">Load it onto the board.</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {!finished && (attempt?.guesses.length ?? 0) > 0 && (
            <p className="mt-2 text-xs text-ink-soft">Tap a guess to load it onto the board.</p>
          )}
        </Card>

        <Card>
          <Eyebrow>Hints</Eyebrow>
          <HintsPanel
            hints={attempt?.hints ?? []}
            canTake={attempt !== undefined && !finished}
            taking={hint.isPending}
            error={hint.error === null ? null : errorMessage(hint.error)}
            onTake={() => {
              hint.mutate(puzzle.number);
            }}
          />
        </Card>
      </div>
    </div>
  );
}
