import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/ui';
import { PROVE_MAX_PLIES, type ProveState } from '../useEngine';
import { ProofPlayer } from './ProofPlayer';

function formatNodes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${String(Math.round(n / 1_000))}k`;
  return String(n);
}

function announcement(state: ProveState): string {
  switch (state.status) {
    case 'running':
      return state.progress === null
        ? 'Starting the search.'
        : `Searching ${String(state.progress.plies)}-ply games.`;
    case 'cancelled':
      return 'Cancelled.';
    case 'error':
      return state.message;
    case 'done':
      return state.result.solution !== null
        ? `Found a shortest proof game: ${String(state.result.solution.length)} plies.`
        : `No proof game of up to ${String(state.result.maxPlies)} plies.`;
    case 'idle':
      return '';
  }
}

function Outcome({ state }: { state: ProveState }) {
  switch (state.status) {
    case 'idle':
      return (
        <p className="text-sm text-ink-soft">
          Searches for the shortest game from the starting position that reaches this position, up
          to {PROVE_MAX_PLIES} plies.
        </p>
      );
    case 'running': {
      const p = state.progress;
      return (
        <p className="text-sm">
          {p === null
            ? 'Starting the search…'
            : `Searching ${String(p.plies)}-ply games… ${formatNodes(p.nodes)} positions, ${(p.elapsedMs / 1000).toFixed(1)} s`}
        </p>
      );
    }
    case 'cancelled':
      return <p className="text-sm">Cancelled.</p>;
    case 'error':
      return <p className="text-sm text-bad">{state.message}</p>;
    case 'done': {
      const r = state.result;
      if (r.solution !== null) {
        return (
          <p className="text-sm">
            <Icon name="check" className="mr-1 inline h-4 w-4 text-ok" />
            Found a shortest proof game: {r.solution.length} plies ({formatNodes(r.nodes)} positions
            searched).
          </p>
        );
      }
      if (r.status !== 'complete') return <p className="text-sm">The search stopped early.</p>;
      if (r.minimumPlies === null) {
        return (
          <p className="text-sm">No game from the starting position can reach this position.</p>
        );
      }
      return (
        <p className="text-sm">
          No proof game of up to {r.maxPlies} plies.
          {r.minimumPlies > r.maxPlies
            ? ` Any game reaching it needs at least ${String(r.minimumPlies)} plies.`
            : ' A longer one may still exist.'}
        </p>
      );
    }
  }
}

/** "Prove it" (SPEC §9.2): runs on request, shows progress, can be cancelled. */
export function Prove({
  state,
  onStart,
  onCancel,
}: {
  state: ProveState;
  onStart: () => void;
  onCancel: () => void;
}) {
  const running = state.status === 'running';
  const solution = state.status === 'done' ? state.result.solution : null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {running ? (
          <Button onClick={onCancel}>
            <Icon name="stop" className="h-4 w-4" />
            Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={onStart}>
            <Icon name="play" className="h-4 w-4" />
            Prove it
          </Button>
        )}
      </div>
      <Outcome state={state} />
      {/* Screen readers hear the length being searched and the outcome, not every node count. */}
      <p className="sr-only" aria-live="polite">
        {announcement(state)}
      </p>
      {solution !== null && solution.length > 0 && (
        <div className="mt-4">
          <ProofPlayer key={solution.join(' ')} proof={solution} title="Proof game" />
        </div>
      )}
    </div>
  );
}
