import { useState, type ReactNode } from 'react';
import { Board } from '../components/Board';
import { Icon } from '../components/Icon';
import { Button, ButtonLink, Card, PageTitle } from '../components/ui';
import { ProofPlayer } from '../features/lab/report/ProofPlayer';
import { useTitle } from '../lib/useTitle';

function labLink(fen: string): string {
  return `/lab?fen=${encodeURIComponent(fen)}`;
}

/** One interactive example: a board, a question, and a "Reveal" that explains the deduction. */
function Example({
  id,
  title,
  fen,
  question,
  revealLabel,
  highlights = [],
  arrows = [],
  children,
}: {
  id: string;
  title: string;
  fen: string;
  question: ReactNode;
  revealLabel: string;
  highlights?: string[];
  arrows?: [string, string][];
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Card labelledBy={`${id}-title`} className="grid gap-5 md:grid-cols-[minmax(0,16rem)_1fr]">
      <div className="mx-auto w-full max-w-64">
        <Board
          fen={fen}
          label={title}
          coordinates
          highlights={shown ? highlights : []}
          arrows={shown ? arrows : []}
        />
      </div>
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-2xl font-semibold">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-ink">{question}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            aria-expanded={shown}
            aria-controls={`${id}-answer`}
            onClick={() => {
              setShown((s) => !s);
            }}
          >
            <Icon name={shown ? 'cross' : 'search'} className="h-4 w-4" />
            {shown ? 'Hide' : revealLabel}
          </Button>
          <ButtonLink to={labLink(fen)}>Open in the Lab</ButtonLink>
        </div>
        {/* Rendered only when shown: a board inside a hidden element would be measured at 0 px. */}
        <div
          id={`${id}-answer`}
          hidden={!shown}
          className="mt-4 space-y-2 border-l-4 border-accent pl-4"
        >
          {shown && children}
        </div>
      </div>
    </Card>
  );
}

const PROOF = ['g2g4', 'h7h5', 'g4h5', 'h8h5', 'e2e4', 'h5a5'];

export function AboutPage() {
  useTitle('About');
  return (
    <>
      <PageTitle lead="Most chess puzzles look forward: what's the best move? Retrograde analysis looks backward: given a position, what must have happened to reach it?">
        Thinking backwards
      </PageTitle>

      <div className="max-w-3xl space-y-3 text-ink">
        <p>
          Every position on a chessboard is the end of a story. Some stories are impossible: a pawn
          can't stand on its first rank, and a side can't have nine pawns. Others are possible but
          leave clues. A pawn off its file must have captured. A castled king means its rook never
          moved before. And if it's White to move, Black made the last move.
        </p>
        <p>
          Retrograde analysis collects those clues, like a detective, until only one story fits. The
          three boards below each hide one idea. Try to work it out, then reveal the answer.
        </p>
      </div>

      <div className="mt-8 space-y-6">
        <Example
          id="last-move"
          title="What happened last?"
          fen="6k1/4Kppp/8/8/8/8/8/8 w - - 0 1"
          question={
            <p>
              It's White to move, so Black just moved. Black has a king and three pawns on their
              starting squares. Which piece moved, and where did it come from?
            </p>
          }
          revealLabel="Reveal the last move"
          highlights={['g8', 'h8', 'f8']}
          arrows={[['h8', 'g8']]}
        >
          <p>
            The pawns on f7, g7 and h7 are on their starting squares, so they never moved. The black
            king made the last move.
          </p>
          <p>
            It can't have come from f8, because there it would have stood next to the white king on
            e7, and kings can never touch. So it came from h8: the last move was{' '}
            <strong>…Kh8-g8</strong>, perhaps capturing a white piece on g8. Working backwards one
            move like this is called a retraction, and the Lab lists every possible one.
          </p>
        </Example>

        <Example
          id="captures"
          title="Counting captures"
          fen="rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1"
          question={
            <p>
              Almost the starting position: just one white pawn has moved, to c3. It looks like
              1.c3, but something is off. What?
            </p>
          }
          revealLabel="Reveal the contradiction"
          highlights={['c3', 'c2', 'b2']}
          arrows={[['b2', 'c3']]}
        >
          <p>
            The c-pawn is still on c2, so the pawn on c3 can't be it. The only other pawn that can
            reach c3 is the b-pawn, and a pawn changes file only by capturing. So White captured a
            black piece on c3.
          </p>
          <p>
            But all 16 black pieces are still on the board. Nothing was captured, so this position
            is <strong>illegal</strong>. The engine does this accounting for every pawn at once, by
            matching each pawn to a starting file with as few captures as possible.
          </p>
        </Example>

        <Example
          id="proof-game"
          title="A proof game"
          fen="rnbqkbn1/ppppppp1/8/r7/4P3/8/PPPP1P1P/RNBQKBNR w - - 0 1"
          question={
            <>
              <p>
                A proof game is a game from the starting position that reaches a given position in
                an exact number of moves. This one takes 6 plies (3 moves each).
              </p>
              <p>White's g-pawn has vanished, Black's rook is on a5 and its h-pawn is gone. How?</p>
            </>
          }
          revealLabel="Play the proof"
        >
          <ProofPlayer proof={PROOF} title="The proof game" />
          <p>
            Black's rook can only leave h8 once the h-pawn is gone, and the white g-pawn must
            disappear too: so g4, h5, gxh5, Rxh5. White still has one move, which must be e4 (it
            explains the pawn on e4), and the rook ends the game with Ra5. No other 6-ply game
            reaches this position. That uniqueness is what makes it a fair daily puzzle.
          </p>
        </Example>
      </div>
    </>
  );
}
