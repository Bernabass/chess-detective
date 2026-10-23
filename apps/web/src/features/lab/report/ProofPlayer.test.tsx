import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProofPlayer } from './ProofPlayer';

vi.mock('../../../components/Board', async () => ({
  Board: (await import('../../../test/BoardStub')).BoardStub,
}));

const PROOF = ['g2g4', 'h7h5', 'g4h5', 'h8h5', 'e2e4', 'h5a5'];

describe('ProofPlayer', () => {
  it('starts at the end and steps through the game with buttons, scrubber and move list', () => {
    render(<ProofPlayer proof={PROOF} title="Proof" />);
    const board = (): HTMLElement => screen.getByRole('img', { name: /^Proof, after/ });
    expect(screen.getByText(/ply 6 of 6/)).toBeInTheDocument();
    expect(board().dataset.fen).toMatch(/^rnbqkbn1\/ppppppp1\/8\/r7\/4P3\/8\/PPPP1P1P\/RNBQKBNR w/);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText(/Starting position/)).toBeInTheDocument();
    expect(board().dataset.fen).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);

    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText(/After 1\.g4/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: 'Proof game position' }), {
      target: { value: '4' },
    });
    expect(screen.getByText(/After 2…Rxh5/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3.e4' }));
    expect(screen.getByRole('button', { name: '3.e4' })).toHaveAttribute('aria-current', 'step');
  });
});
