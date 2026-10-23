import { useQuery } from '@tanstack/react-query';
import { fetchApiStatus, useApi } from '../lib/api';

/** Site footer: license, source, and whether the game server is reachable. */
export function Footer() {
  const api = useApi();
  const { data: status } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApiStatus(api),
    retry: false,
  });

  const dot = status === 'ok' ? 'bg-ok' : status === 'unavailable' ? 'bg-bad' : 'bg-ink-soft';
  const text =
    status === undefined
      ? 'Server: checking…'
      : status === 'ok'
        ? 'Server: online'
        : 'Server: offline';

  return (
    <footer className="mt-12 border-t border-rule">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <p>
          Retrograde is free software (GPL-3.0-or-later).{' '}
          <a
            href="https://github.com/Bernabass/chess-detective"
            className="text-ink underline decoration-card-edge underline-offset-4 hover:decoration-accent"
          >
            Source code
          </a>
        </p>
        <p role="status" className="flex items-center gap-2">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {text}
        </p>
      </div>
    </footer>
  );
}
