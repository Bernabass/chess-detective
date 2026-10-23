import { useParams } from 'react-router';
import { Placeholder } from '../components/Placeholder';
import { useTitle } from '../lib/useTitle';

const RULES = [
  'Everyone gets the same target position each day.',
  'Find the game from the starting position that reaches it in exactly N moves.',
  'Six guesses, with feedback for every move, and three optional hints.',
];

/** /daily and /daily/:number (the game itself arrives in Phase 7). */
export function DailyPage() {
  const { number } = useParams();
  const title = number === undefined ? 'Daily proof game' : `Daily proof game #${number}`;
  useTitle(title);
  return (
    <Placeholder
      title={title}
      lead="A new detective case every day: one position, one exact history."
    >
      <ul className="mt-4 space-y-2">
        {RULES.map((rule) => (
          <li key={rule} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
    </Placeholder>
  );
}
