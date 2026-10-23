import { Link } from 'react-router';
import { Board } from '../components/Board';
import { Icon, type IconName } from '../components/Icon';
import { ButtonLink, Card } from '../components/ui';
import { useTitle } from '../lib/useTitle';

const ENTRIES: { to: string; title: string; text: string; icon: IconName }[] = [
  {
    to: '/daily',
    title: 'Daily proof game',
    text: 'One target position a day. Find the exact game that reaches it in six guesses.',
    icon: 'play',
  },
  {
    to: '/lab',
    title: 'The Lab',
    text: 'Set up any position and let the engine deduce what must have happened.',
    icon: 'search',
  },
  {
    to: '/about',
    title: 'How it works',
    text: 'Retrograde analysis in five minutes, with boards you can poke at.',
    icon: 'question',
  },
];

const TEASER = '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1';

export function HomePage() {
  useTitle(null);
  return (
    <>
      <section className="grid items-center gap-8 md:grid-cols-[1fr_minmax(0,20rem)]">
        <div>
          <p className="mb-3 font-sans text-xs font-semibold tracking-[0.14em] text-brass uppercase">
            Chess detective puzzles
          </p>
          <h1 className="text-4xl leading-tight font-semibold sm:text-5xl">
            Don't ask for the best move. Ask what happened.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">
            Retrograde puzzles run the game backwards. Look at a position and work out which move
            came last, whether it could ever arise, and the exact game that reached it.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink to="/lab" variant="primary">
              <Icon name="search" className="h-4 w-4" />
              Open the Lab
            </ButtonLink>
            <ButtonLink to="/about">How it works</ButtonLink>
          </div>
        </div>
        <Card as="div" className="mx-auto w-full max-w-80">
          <Board fen={TEASER} label="Teaser position: who moved last?" coordinates={false} />
          <p className="mt-3 font-display text-lg font-semibold">Who moved last?</p>
          <p className="text-sm text-ink-soft">
            White is to move, so Black just moved. Only one black piece could have, and only from
            one square.{' '}
            <Link
              to={`/lab?fen=${encodeURIComponent(TEASER)}`}
              className="text-ink underline underline-offset-4"
            >
              Ask the Lab
            </Link>
          </p>
        </Card>
      </section>

      <section aria-label="Where to start" className="mt-12 grid gap-4 md:grid-cols-3">
        {ENTRIES.map((e) => (
          <Link
            key={e.to}
            to={e.to}
            className="group rounded-lg border border-card-edge bg-card p-5 text-ink no-underline shadow-card transition hover:border-accent/60"
          >
            <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-md bg-paper text-accent">
              <Icon name={e.icon} />
            </span>
            <h2 className="text-xl font-semibold group-hover:text-accent">{e.title}</h2>
            <p className="mt-1 text-sm text-ink-soft">{e.text}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
