import { useEffect, useRef } from 'react';
import type { Puzzle } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ButtonLink } from '../../components/ui';
import { ProofPlayer } from '../lab/report/ProofPlayer';
import { Countdown } from './Countdown';
import { describeDuration, formatDuration } from './format';
import { ShareCard } from './ShareCard';

/** After the last guess: the result, the solution played back, the share card and what's next. */
export function ResultPanel({
  puzzle,
  guest,
  currentStreak,
  onNextPuzzle,
  justFinished,
}: {
  puzzle: Puzzle;
  /** Undefined while /auth/me is loading: show neither the guest prompt nor the streak yet. */
  guest: boolean | undefined;
  currentStreak: number | null;
  onNextPuzzle: () => void;
  /** The last guess was just made here: move focus to the result (Submit has gone). */
  justFinished: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (justFinished) heading.current?.focus();
  }, [justFinished]);
  const attempt = puzzle.attempt;
  if (attempt === undefined) return null;
  const isToday = puzzle.day === new Date().toISOString().slice(0, 10);
  const solved = attempt.status === 'solved';
  const guesses = attempt.guesses.length;
  const seconds =
    attempt.finishedAt === undefined
      ? null
      : (Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000;
  const hints =
    attempt.hintsUsed === 0
      ? 'no hints'
      : `${String(attempt.hintsUsed)} hint${attempt.hintsUsed === 1 ? '' : 's'}`;

  return (
    <div data-result={attempt.status}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
            solved ? 'bg-hit text-hit-ink' : 'bg-miss text-miss-ink'
          }`}
        >
          <Icon name={solved ? 'trophy' : 'cross'} className="h-5 w-5" />
        </span>
        <div>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
            {solved ? 'Case closed' : 'Case unsolved'}
          </h2>
          <p className="text-ink-soft">
            {solved
              ? `Solved in ${String(guesses)}/6 with ${hints}`
              : `Six guesses, no solution (${hints})`}
            {seconds !== null && solved && (
              <>
                {' in '}
                <span aria-hidden="true">{formatDuration(seconds)}</span>
                <span className="sr-only">{describeDuration(seconds)}</span>
              </>
            )}
            .
          </p>
          {!attempt.archive && currentStreak !== null && guest === false && (
            <p className="mt-1 text-sm">
              Current streak: <strong>{currentStreak}</strong> day{currentStreak === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      {guest === true && !attempt.archive && (
        <div className="mt-4 rounded-md border border-card-edge bg-paper px-3 py-2 text-sm">
          <p>
            You're playing as a guest. Create an account to keep this result, start a streak and
            appear on the leaderboard.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink to={`/register?next=${encodeURIComponent('/daily')}`} variant="primary">
              Create an account
            </ButtonLink>
            <ButtonLink to={`/login?next=${encodeURIComponent('/daily')}`}>Sign in</ButtonLink>
          </div>
        </div>
      )}

      {puzzle.solution !== undefined && (
        <div className="mt-5">
          <ProofPlayer proof={puzzle.solution} title="The solution" />
        </div>
      )}

      <div className="mt-5">
        <h3 className="mb-2 text-lg font-semibold">Share your result</h3>
        <ShareCard
          number={puzzle.number}
          difficulty={puzzle.difficulty}
          plies={puzzle.plies}
          status={solved ? 'solved' : 'failed'}
          feedback={attempt.guesses.map((g) => g.feedback)}
          hintsUsed={attempt.hintsUsed}
          archive={attempt.archive}
        />
      </div>

      <div className="mt-5 border-t border-rule pt-4">
        {attempt.archive ? (
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/daily" variant="primary">
              Today's puzzle
            </ButtonLink>
            <ButtonLink to="/archive">
              <Icon name="archive" className="h-4 w-4" />
              More from the archive
            </ButtonLink>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Countdown day={puzzle.day} onReady={onNextPuzzle} />
            <div className="flex flex-wrap gap-2">
              <ButtonLink to={`/leaderboard?number=${String(puzzle.number)}`}>
                <Icon name="trophy" className="h-4 w-4" />
                {isToday ? "Today's leaderboard" : `Leaderboard for #${String(puzzle.number)}`}
              </ButtonLink>
              <ButtonLink to="/archive">
                <Icon name="archive" className="h-4 w-4" />
                Play the archive
              </ButtonLink>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
