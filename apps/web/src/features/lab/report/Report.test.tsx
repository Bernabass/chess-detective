import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../../worker/api';
import { LastMoves } from './LastMoves';
import { groupFindings } from './findings';
import { Notes } from './Notes';
import { verdictReason } from './verdict';
import { VerdictBanner } from './VerdictBanner';

vi.mock('../../../components/Board', async () => ({
  Board: (await import('../../../test/BoardStub')).BoardStub,
}));

/** A real engine report for a FEN (the components render what the worker would send). */
function report(fen: string, depth = 3) {
  const r = analyze(fen, depth);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const THREE_PAWNS = 'k7/8/8/8/8/PP6/PP6/K7 w - - 0 1';
const WHO_MOVED = '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1';

describe('VerdictBanner', () => {
  it('pairs every verdict with an icon and a word, never colour alone', () => {
    const { rerender, container } = render(<VerdictBanner verdict={report(THREE_PAWNS).verdict} />);
    expect(screen.getByText('Illegal')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/has no possible starting file/)).toBeInTheDocument();

    rerender(
      <VerdictBanner
        verdict={report('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2').verdict}
      />,
    );
    expect(screen.getByText('Legal (proved)')).toBeInTheDocument();
    expect(screen.getByText(/a 3-ply game/)).toBeInTheDocument();

    rerender(<VerdictBanner verdict={report(WHO_MOVED).verdict} />);
    expect(screen.getByText('Undecided')).toBeInTheDocument();
  });

  it('explains undecided verdicts by their reason', () => {
    expect(verdictReason({ kind: 'undecided', findings: [], reason: 'search-limit' })).toMatch(
      /ran out of time/,
    );
    expect(
      verdictReason({ kind: 'undecided', findings: [], reason: 'no-contradiction-found' }),
    ).toMatch(/Prove it/);
    expect(verdictReason({ kind: 'legal', proof: [], findings: [] })).toMatch(/starting position/);
  });
});

describe('Notes', () => {
  it('groups repeated rules into one note, contradictions first', () => {
    const groups = groupFindings(report(THREE_PAWNS).verdict.findings);
    expect(groups.map((g) => g.rule)).toEqual([
      'PAWN_STRUCTURE_IMPOSSIBLE',
      'NO_POSSIBLE_LAST_MOVE',
      'CASTLING_LOST',
    ]);
    expect(groups[2]?.messages).toHaveLength(4);
  });

  it('highlights a note on hover and focus, and pins it on click', () => {
    const onHighlight = vi.fn();
    render(<Notes findings={report(THREE_PAWNS).verdict.findings} onHighlight={onHighlight} />);
    const note = screen.getByRole('button', { name: /could only have started/ });

    fireEvent.mouseEnter(note);
    expect(onHighlight).toHaveBeenLastCalledWith({ squares: ['a2', 'b2', 'a3'], arrows: [] });
    fireEvent.mouseLeave(note);
    expect(onHighlight).toHaveBeenLastCalledWith(null);

    fireEvent.focus(note);
    expect(onHighlight).toHaveBeenLastCalledWith(
      expect.objectContaining({ squares: ['a2', 'b2', 'a3'] }),
    );

    fireEvent.click(note);
    expect(note).toHaveAttribute('aria-pressed', 'true');
    fireEvent.blur(note);
    // Pinned: leaving the note keeps its highlight.
    expect(onHighlight).toHaveBeenLastCalledWith(
      expect.objectContaining({ squares: ['a2', 'b2', 'a3'] }),
    );
  });

  it('labels each note as a contradiction or a deduction', () => {
    render(<Notes findings={report(THREE_PAWNS).verdict.findings} onHighlight={() => undefined} />);
    expect(screen.getAllByText('Contradiction')).toHaveLength(2);
    expect(screen.getByText('Deduction')).toBeInTheDocument();
  });

  it('says so when there is nothing to note', () => {
    render(<Notes findings={[]} onHighlight={() => undefined} />);
    expect(screen.getByText(/No notes/)).toBeInTheDocument();
  });
});

describe('LastMoves', () => {
  it('shows each move with a viability word and takes it back', () => {
    const r = report(WHO_MOVED);
    const onTakeBack = vi.fn();
    const onDepth = vi.fn();
    render(
      <LastMoves
        result={r.lastMoves}
        depth={3}
        onDepth={onDepth}
        onTakeBack={onTakeBack}
        onPreview={() => undefined}
      />,
    );
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(r.lastMoves.moves.length);
    // Every row says its viability in words (the icon and colour are extras).
    const words = within(list).getAllByText(/^(Possible|Impossible|Unknown)$/);
    expect(words).toHaveLength(r.lastMoves.moves.length);
    expect(within(list).getAllByText('Possible').length).toBeGreaterThan(0);

    const kh8g8 = r.lastMoves.moves.find((m) => m.move === 'h8g8' && m.uncaptured === null);
    if (kh8g8 === undefined) throw new Error('missing Kh8-g8');
    fireEvent.click(screen.getByRole('button', { name: `Take back ${kh8g8.notation}` }));
    expect(onTakeBack).toHaveBeenCalledWith(expect.objectContaining({ move: 'h8g8' }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } });
    expect(onDepth).toHaveBeenCalledWith(5);
  });

  it('says when no move could have led to the position', () => {
    const r = report('7k/8/8/8/8/8/PPP5/KB6 b - - 0 1');
    render(
      <LastMoves
        result={r.lastMoves}
        depth={3}
        onDepth={() => undefined}
        onTakeBack={() => undefined}
        onPreview={() => undefined}
      />,
    );
    expect(screen.getByText('No move could have led here.')).toBeInTheDocument();
  });
});
