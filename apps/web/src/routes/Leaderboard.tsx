import { Link, useSearchParams } from 'react-router';
import type { DailyEntry, Metric } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Card, PageTitle } from '../components/ui';
import { describeDuration, ELLIPSIS, formatDuration } from '../features/daily/format';
import { errorMessage } from '../lib/problem';
import { useAllTimeLeaderboard, useDailyLeaderboard, useMe, usePuzzle } from '../lib/queries';
import { useTitle } from '../lib/useTitle';

const METRICS: { value: Metric; label: string; column: string }[] = [
  { value: 'current_streak', label: 'Current streak', column: 'Days' },
  { value: 'max_streak', label: 'Best streak', column: 'Days' },
  { value: 'solved', label: 'Solved', column: 'Solved' },
];

function YouBadge() {
  return (
    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-ink">
      You
    </span>
  );
}

function Player({ username, you }: { username: string; you: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center">
      <Link
        to={`/u/${encodeURIComponent(username)}`}
        className="block max-w-24 truncate text-ink underline-offset-4 hover:underline sm:max-w-48"
      >
        {username}
      </Link>
      {you && <YouBadge />}
    </span>
  );
}

const th =
  'px-2 py-2 text-left sm:px-3 text-xs font-semibold tracking-wide text-ink-soft uppercase';
const td = 'px-1.5 py-2 sm:px-3';

function DailyRows({ entries, me }: { entries: readonly DailyEntry[]; me: string | undefined }) {
  return (
    <>
      {entries.map((e) => {
        const you = e.username === me;
        return (
          <tr
            key={e.username}
            className={you ? 'bg-accent/10 font-medium' : undefined}
            aria-current={you ? 'true' : undefined}
          >
            <td className={`${td} font-mono tabular-nums`}>{e.rank}</td>
            <td className={td}>
              <Player username={e.username} you={you} />
            </td>
            <td className={`${td} text-right tabular-nums`}>{e.guesses}</td>
            <td className={`${td} text-right tabular-nums`}>{e.hints}</td>
            <td className={`${td} text-right font-mono tabular-nums`}>
              <span aria-hidden="true">{formatDuration(e.seconds)}</span>
              <span className="sr-only">{describeDuration(e.seconds)}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function DailyBoard({ number, today }: { number: number; today: number }) {
  const board = useDailyLeaderboard(number);
  const me = useMe();
  const [, setParams] = useSearchParams();
  const username = me.data !== undefined && !me.data.guest ? me.data.username : undefined;
  const go = (n: number): void => {
    setParams(n === today ? {} : { number: String(n) });
  };
  const you = board.data?.you;
  const listed = you !== undefined && board.data?.entries.some((e) => e.username === you.username);

  return (
    <Card flush>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <h2 className="text-xl font-semibold">
          Puzzle #{number}
          {number === today && (
            <span className="text-base font-normal text-ink-soft"> (today)</span>
          )}
        </h2>
        <div className="flex gap-1">
          <Button
            onClick={() => {
              go(number - 1);
            }}
            disabled={number <= 1}
          >
            <Icon name="prev" className="h-4 w-4" title="Previous puzzle" />
          </Button>
          <Button
            onClick={() => {
              go(number + 1);
            }}
            disabled={number >= today}
          >
            <Icon name="next" className="h-4 w-4" title="Next puzzle" />
          </Button>
        </div>
      </div>
      {board.isPending && <p className="p-4 text-ink-soft">Loading{ELLIPSIS}</p>}
      {board.isError && (
        <p role="alert" className="p-4">
          {errorMessage(board.error)}
        </p>
      )}
      {board.data !== undefined &&
        (board.data.entries.length === 0 ? (
          <p className="p-4 text-ink-soft">
            Nobody with an account has solved this one yet.{' '}
            {number === today && (
              <Link to="/daily" className="text-ink underline underline-offset-4">
                Be the first.
              </Link>
            )}
          </p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Leaderboard for puzzle {number}: fewer guesses, then fewer hints, then a shorter
                time rank higher.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    #
                  </th>
                  <th scope="col" className={th}>
                    Player
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Guesses
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Hints
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                <DailyRows entries={board.data.entries} me={username} />
                {you !== undefined && !listed && <DailyRows entries={[you]} me={username} />}
              </tbody>
            </table>
          </div>
        ))}
      <p className="border-t border-rule px-4 py-2 text-xs text-ink-soft">
        Ranked by guesses, then hints, then time. Guests and archive play aren't listed.
      </p>
    </Card>
  );
}

function AllTimeBoard({ metric }: { metric: Metric }) {
  const board = useAllTimeLeaderboard(metric);
  const me = useMe();
  const username = me.data !== undefined && !me.data.guest ? me.data.username : undefined;
  const column = METRICS.find((m) => m.value === metric)?.column ?? '';
  return (
    <Card flush>
      {board.isPending && <p className="p-4 text-ink-soft">Loading{ELLIPSIS}</p>}
      {board.isError && (
        <p role="alert" className="p-4">
          {errorMessage(board.error)}
        </p>
      )}
      {board.data !== undefined &&
        (board.data.entries.length === 0 ? (
          <p className="p-4 text-ink-soft">No one on this board yet.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">
              All-time leaderboard: {METRICS.find((m) => m.value === metric)?.label}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  #
                </th>
                <th scope="col" className={th}>
                  Player
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {column}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {board.data.entries.map((e) => {
                const you = e.username === username;
                return (
                  <tr key={e.username} className={you ? 'bg-accent/10 font-medium' : undefined}>
                    <td className={`${td} font-mono tabular-nums`}>{e.rank}</td>
                    <td className={td}>
                      <Player username={e.username} you={you} />
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{e.value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </Card>
  );
}

function Tabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap rounded-md border border-card-edge bg-card p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => {
            onChange(o.value);
          }}
          className={`rounded px-3 py-1.5 text-sm font-medium transition ${
            value === o.value ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** /leaderboard: a day's ranking (?number=) and the all-time boards (?view=all-time&metric=). */
export function LeaderboardPage() {
  useTitle('Leaderboard');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'all-time' ? 'all-time' : 'daily';
  const metricParam = params.get('metric');
  const metric = METRICS.find((m) => m.value === metricParam)?.value ?? 'current_streak';
  const today = usePuzzle(undefined);
  const todayNumber = today.data?.number;
  const asked = Number.parseInt(params.get('number') ?? '', 10);
  const number =
    todayNumber === undefined
      ? undefined
      : Number.isInteger(asked) && asked >= 1 && asked <= todayNumber
        ? asked
        : todayNumber;

  return (
    <>
      <PageTitle lead="Today's sharpest detectives, and the all-time records. Fewer guesses and hints rank higher.">
        Leaderboard
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          label="Leaderboard"
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'all-time', label: 'All time' },
          ]}
          value={view}
          onChange={(v) => {
            setParams(v === 'daily' ? {} : { view: v });
          }}
        />
        {view === 'all-time' && (
          <Tabs
            label="Ranked by"
            options={METRICS}
            value={metric}
            onChange={(m) => {
              setParams({ view: 'all-time', metric: m });
            }}
          />
        )}
      </div>
      {view === 'daily' ? (
        number === undefined || todayNumber === undefined ? (
          today.isError ? (
            <Card>
              <p role="alert">{errorMessage(today.error)}</p>
            </Card>
          ) : (
            <p className="text-ink-soft">Loading{ELLIPSIS}</p>
          )
        ) : (
          <DailyBoard number={number} today={todayNumber} />
        )
      ) : (
        <AllTimeBoard metric={metric} />
      )}
    </>
  );
}
