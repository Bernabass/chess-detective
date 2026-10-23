import { ButtonLink, Card } from '../components/ui';
import { useTitle } from '../lib/useTitle';

export function NotFoundPage() {
  useTitle('Not found');
  return (
    <Card className="mx-auto max-w-xl text-center">
      <p className="font-mono text-sm text-brass">404</p>
      <h1 className="mt-2 text-3xl font-semibold">This case file doesn't exist</h1>
      <p className="mt-2 text-ink-soft">
        No page lives at this address. Perhaps it was never there, or perhaps the trail went cold.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <ButtonLink to="/" variant="primary">
          Back to the start
        </ButtonLink>
        <ButtonLink to="/lab">Open the Lab</ButtonLink>
      </div>
    </Card>
  );
}
