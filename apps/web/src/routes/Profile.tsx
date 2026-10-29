import { useParams } from 'react-router';
import { DistributionChart } from '../components/DistributionChart';
import { Icon } from '../components/Icon';
import { ButtonLink, Card, Eyebrow, PageTitle } from '../components/ui';
import { ApiError, errorMessage } from '../lib/problem';
import { useMe, useProfile } from '../lib/queries';
import { useTitle } from '../lib/useTitle';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-card-edge bg-paper px-3 py-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** /u/:username: a public profile (SPEC §8.5). */
export function ProfilePage() {
  const { username = '' } = useParams();
  const profile = useProfile(username);
  const me = useMe();
  useTitle(username);
  const own =
    me.data !== undefined && !me.data.guest && me.data.username === profile.data?.username;

  if (profile.isPending) {
    return (
      <PageTitle>
        <span className="break-all">{username}</span>
      </PageTitle>
    );
  }
  if (profile.isError) {
    const missing = profile.error instanceof ApiError && [400, 404].includes(profile.error.status);
    return (
      <>
        <PageTitle>
          <span className="break-all">{username}</span>
        </PageTitle>
        <Card className="max-w-xl">
          <p role={missing ? undefined : 'alert'} className="font-display text-lg">
            {missing ? 'No detective by that name.' : errorMessage(profile.error)}
          </p>
          <div className="mt-3">
            <ButtonLink to="/leaderboard">See the leaderboard</ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  const p = profile.data;
  const s = p.stats;
  const joined = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
    new Date(p.joined),
  );
  return (
    <>
      <PageTitle lead={`Detective since ${joined}.`}>
        <span className="inline-flex max-w-full flex-wrap items-center gap-2 break-all">
          <Icon name="user" className="h-7 w-7 text-brass" />
          {p.username}
          {own && <span className="text-base font-normal text-ink-soft">(you)</span>}
        </span>
      </PageTitle>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <Eyebrow>Daily puzzles</Eyebrow>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Played" value={String(s.played)} />
            <Tile label="Solved" value={String(s.solved)} />
            <Tile label="Win rate" value={`${String(Math.round(s.winRate * 100))}%`} />
            <Tile label="Current streak" value={String(s.currentStreak)} />
            <Tile label="Best streak" value={String(s.maxStreak)} />
            <Tile label="Average hints" value={s.averageHints.toFixed(1)} />
          </dl>
          <p className="mt-3 text-xs text-ink-soft">Archive (practice) puzzles don't count here.</p>
        </Card>
        <Card>
          <Eyebrow>Guess distribution</Eyebrow>
          {s.played === 0 ? (
            <p className="text-sm text-ink-soft">No daily puzzles finished yet.</p>
          ) : (
            <DistributionChart counts={s.guessDistribution} />
          )}
        </Card>
      </div>
    </>
  );
}
