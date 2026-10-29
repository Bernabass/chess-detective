import { useEffect, useRef } from 'react';
import { Board } from '../../components/Board';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { proofSteps } from '../../lib/notation';
import { FeedbackCell, FeedbackRow } from './Feedback';
import { FEEDBACK } from './feedbackKinds';
import { HOW_TO_EXAMPLE, markHowToPlaySeen } from './howto';

const exampleSteps = proofSteps(HOW_TO_EXAMPLE.guess);
const solutionSteps = proofSteps(HOW_TO_EXAMPLE.solution);

/**
 * How to play (shown once on a first visit, reopenable): the goal, the feedback squares and a
 * tiny example that is itself a unique shortest proof game (howto.test.ts checks it).
 */
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal(); // traps focus; Escape closes it
      markHowToPlaySeen();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="how-to-play-title"
      onClose={onClose}
      className="m-auto max-h-[92dvh] w-[min(36rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-card-edge bg-card p-0 text-ink shadow-card backdrop:bg-black/50"
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="how-to-play-title" className="text-2xl font-semibold">
            How to play
          </h2>
          <Button variant="ghost" className="-mt-1 -mr-2 px-2" onClick={onClose}>
            <Icon name="cross" className="h-5 w-5" title="Close" />
          </Button>
        </div>

        <p className="mt-3">
          Each day there's one <strong>target position</strong>. Find the game that reaches it:
          start from the normal starting position and play <strong>exactly</strong> the number of
          moves the puzzle asks for, so the last one leaves this exact position.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Lengths count <em>plies</em>: one move by one side. "2.0 moves" is 4 plies (White, Black,
          White, Black); "4.5 moves" is 9.
        </p>

        <h3 className="mt-5 text-lg font-semibold">Six guesses, one square per ply</h3>
        <p className="mt-1 text-sm">
          Play a whole game on the board and submit it. Each ply gets a square:
        </p>
        <ul className="mt-2 space-y-2">
          {(['G', 'Y', 'X'] as const).map((k) => (
            <li key={k} className="flex items-center gap-3">
              <FeedbackCell kind={k} size="sm" />
              <span>{FEEDBACK[k].long}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-lg font-semibold">A tiny example</h3>
        <div className="mt-2 grid items-start gap-4 sm:grid-cols-[9rem_1fr]">
          <div className="mx-auto w-36 sm:w-full">
            <Board
              fen={HOW_TO_EXAMPLE.target}
              label="Example target, after 2.0 moves"
              coordinates={false}
            />
          </div>
          <div className="text-sm">
            <p>
              Target: reach this in <strong>2.0 moves (4 plies)</strong>. A guess:
            </p>
            <div className="mt-2 max-w-48">
              <FeedbackRow
                feedback={HOW_TO_EXAMPLE.feedback}
                steps={exampleSteps}
                label="Example guess"
              />
            </div>
            <ul className="mt-2 space-y-1 text-ink-soft">
              <li>
                <strong className="text-ink">Nf3</strong> isn't in the solution.
              </li>
              <li>
                <strong className="text-ink">e5</strong> and{' '}
                <strong className="text-ink">Ke7</strong> are right, at the right plies.
              </li>
              <li>
                <strong className="text-ink">e4</strong> is right, but it belongs on move 1.
              </li>
            </ul>
            <details className="mt-2">
              <summary className="cursor-pointer text-ink underline underline-offset-4">
                Show the solution
              </summary>
              <p className="mt-1 font-mono">{solutionSteps.map((s) => s.label).join(' ')}</p>
            </details>
          </div>
        </div>

        <h3 className="mt-5 text-lg font-semibold">Hints and results</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li>
            Three hints, one at a time: which pieces moved, where the captures are, and one move of
            the solution. Each hint counts against your ranking.
          </li>
          <li>Solve it in fewer guesses and hints to rank higher. Solve every day for a streak.</li>
          <li>Each daily has exactly one solution. A new one arrives at midnight UTC.</li>
        </ul>

        <div className="mt-6 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Start playing
          </Button>
        </div>
      </div>
    </dialog>
  );
}
