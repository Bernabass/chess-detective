import type { ReactNode } from 'react';
import { Card, Eyebrow, PageTitle } from '../components/ui';
import { useTitle } from '../lib/useTitle';

const ISSUES = 'https://github.com/Bernabass/chess-detective/issues';

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className="text-ink underline decoration-card-edge underline-offset-4 hover:decoration-accent"
    >
      {children}
    </a>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card labelledBy={id}>
      <Eyebrow id={id}>{title}</Eyebrow>
      <div className="space-y-3 text-ink">{children}</div>
    </Card>
  );
}

/** /privacy: what Retrograde stores, the cookies it sets, and who else processes requests. */
export function PrivacyPage() {
  useTitle('Privacy');
  return (
    <>
      <PageTitle lead="Retrograde keeps only what it needs to run the game. No ads, no analytics, no tracking.">
        Privacy
      </PageTitle>

      <div className="max-w-3xl space-y-6">
        <Section id="stored" title="What we store">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>An account</strong>: your username and a hash of your password (argon2id). The
              password itself is never stored.
            </li>
            <li>
              <strong>Sign in with Lichess</strong>: your Lichess user id and username, to recognise
              you next time and to link your profile to Lichess. Never your Lichess password, and
              never a Lichess access token: it&apos;s used once to read your username, then revoked.
            </li>
            <li>
              <strong>Your games</strong>: the puzzles you started, your guesses, the hints you took
              and when you started and finished, plus the statistics worked out from them (streaks,
              guess distribution). Your username, results and statistics appear on the public
              leaderboards and your profile page.
            </li>
            <li>
              <strong>Guests</strong>: the same game data under an anonymous id. Guests who never
              made a guess are deleted after 30 days.
            </li>
          </ul>
        </Section>

        <Section id="cookies" title="Cookies and browser storage">
          <p>
            One cookie, <code className="font-mono">rg_session</code>, keeps you signed in (or
            remembers a guest&apos;s games). Scripts can&apos;t read it, it&apos;s only sent to this
            site, and it expires after 30 days without a visit.
          </p>
          <p>
            Only while you sign in with Lichess, a second cookie,{' '}
            <code className="font-mono">rg_oauth</code>, ties the sign-in to your browser. It lasts
            at most 10 minutes and is deleted when the sign-in finishes.
          </p>
          <p>
            Your browser&apos;s local storage holds your theme choice and whether you&apos;ve seen
            How to play. Neither is ever sent to us.
          </p>
        </Section>

        <Section id="tracking" title="No tracking">
          <p>
            There are no analytics, no advertising and no third-party scripts or fonts: everything
            these pages load comes from this site.
          </p>
          <p>
            Our application keeps your IP address only in memory, for at most a couple of hours, to
            limit how fast requests can be made. It never writes IP addresses to its logs or its
            database.
          </p>
        </Section>

        <Section id="others" title="Who else is involved">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Vercel</strong> hosts the site and runs its server, so every request passes
              through Vercel&apos;s platform. Vercel may keep standard request logs, including IP
              addresses, under its own{' '}
              <Out href="https://vercel.com/legal/privacy-policy">privacy policy</Out>.
            </li>
            <li>
              <strong>Neon</strong> hosts the database that holds the data above (
              <Out href="https://neon.com/privacy-policy">Neon&apos;s privacy policy</Out>).
            </li>
            <li>
              <strong>Lichess</strong> is involved only if you choose Sign in with Lichess: you
              approve the sign-in on lichess.org, and Lichess tells us your user id and username (
              <Out href="https://lichess.org/privacy">Lichess&apos;s privacy policy</Out>).
            </li>
          </ul>
        </Section>

        <Section id="questions" title="Questions and deleting your data">
          <p>
            Open an issue on <Out href={ISSUES}>GitHub</Out>. To have your account and its games
            deleted, say which username is yours there.
          </p>
        </Section>
      </div>
    </>
  );
}
