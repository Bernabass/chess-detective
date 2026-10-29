import { Link, useSearchParams } from 'react-router';
import type { ArchiveItem } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, ButtonLink, Card, PageTitle } from '../components/ui';
import { DOT, ELLIPSIS, movesLabel, stars } from '../features/daily/format';
import { errorMessage } from '../lib/problem';
import { useArchive } from '../lib/queries';
import { useTitle } from '../lib/useTitle';

function Result({ item }: { item: ArchiveItem }) {
  const r = item.result;
  if (r === undefined) return <span className="text-ink-soft">Not played</span>;
  if (r.status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 text-ink">
        <Icon name="clock" className="h-4 w-4 text-brass" />
        In progress ({r.guesses}/6)
      </span>
    );
  }
  const solved = r.status === 'solved';
  return (
    <span className="inline-flex items-center gap-1 text-ink">
      <Icon
        name={solved ? 'check' : 'cross'}
        className={`h-4 w-4 ${solved ? 'text-ok' : 'text-bad'}`}
      />
      {solved ? `Solved ${String(r.guesses)}/6` : 'Failed'}
      {r.hintsUsed > 0 && (
        <span className="text-ink-soft">
          {' '}
          {DOT} {r.hintsUsed} hint{r.hintsUsed === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** /archive: every released puzzle, newest first, playable in practice mode (SPEC §8.7). */
export function ArchivePage() {
  useTitle('Archive');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const archive = useArchive(page);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const pages =
    archive.data === undefined
      ? 1
      : Math.max(1, Math.ceil(archive.data.total / archive.data.pageSize));

  const go = (p: number): void => {
    setParams(p === 1 ? {} : { page: String(p) });
  };

  return (
    <>
      <PageTitle lead="Every daily puzzle so far. Earlier days are practice: they don't change your stats, streak or the leaderboard.">
        Archive
      </PageTitle>
      {archive.isPending && <p className="text-ink-soft">Loading the archive{ELLIPSIS}</p>}
      {archive.isError && (
        <Card>
          <p role="alert">{errorMessage(archive.error)}</p>
        </Card>
      )}
      {archive.data !== undefined && (
        <Card flush>
          {archive.data.puzzles.length === 0 ? (
            <p className="p-4 text-ink-soft">No puzzles on this page.</p>
          ) : (
            <ul className="divide-y divide-rule" aria-label="Past puzzles">
              {archive.data.puzzles.map((item) => (
                <li key={item.number}>
                  <Link
                    to={`/daily/${String(item.number)}`}
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 text-ink no-underline hover:bg-paper sm:grid-cols-[4rem_minmax(0,1fr)_auto]"
                  >
                    <span className="row-span-2 font-display text-xl font-semibold sm:row-span-1">
                      #{item.number}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {formatDay(item.day)}
                        {item.day === todayUtc && (
                          <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-ink">
                            Today
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-ink-soft">
                        <span
                          className="text-brass"
                          role="img"
                          aria-label={`Difficulty ${String(item.difficulty)} of 5`}
                        >
                          {stars(item.difficulty)}
                        </span>{' '}
                        {movesLabel(item.plies)} {DOT} {item.plies} plies
                      </span>
                    </span>
                    <span className="text-sm">
                      <Result item={item} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {archive.data !== undefined && pages > 1 && (
        <nav aria-label="Archive pages" className="mt-4 flex items-center justify-between gap-2">
          <Button
            onClick={() => {
              go(page - 1);
            }}
            disabled={page <= 1}
          >
            <Icon name="prev" className="h-4 w-4" />
            Newer
          </Button>
          <span className="text-sm text-ink-soft">
            Page {page} of {pages}
          </span>
          <Button
            onClick={() => {
              go(page + 1);
            }}
            disabled={page >= pages}
          >
            Older
            <Icon name="next" className="h-4 w-4" />
          </Button>
        </nav>
      )}
      <div className="mt-4">
        <ButtonLink to="/daily" variant="primary">
          Today's puzzle
        </ButtonLink>
      </div>
    </>
  );
}
