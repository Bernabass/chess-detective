import { Link } from 'react-router';
import { Board } from '../../components/Board';
import { fromFen, labPath } from './labState';
import { EXAMPLES } from './examples';

/** The Lab's example gallery (SPEC §9.3): teaser titles, a hint, and a small board each. */
export function ExampleGallery() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {EXAMPLES.map((ex) => {
        const fields = fromFen(ex.fen);
        if (fields === null) return null;
        return (
          <li key={ex.id}>
            <Link
              to={labPath(fields)}
              className="group flex h-full gap-3 rounded-lg border border-card-edge bg-card p-3 text-ink no-underline shadow-card transition hover:border-accent/60 xl:flex-col"
            >
              <span className="w-24 shrink-0 xl:w-full">
                <Board fen={ex.fen} label={ex.title} coordinates={false} decorative />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-lg leading-tight font-semibold group-hover:text-accent">
                  {ex.title}
                </span>
                <span className="mt-1 block text-sm text-ink-soft">{ex.hint}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
