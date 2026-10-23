import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FenField } from './FenField';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('FenField', () => {
  it('applies a valid pasted FEN, filling in missing fields', () => {
    const onChange = vi.fn();
    render(<FenField fen={START} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('FEN'), { target: { value: 'k7/8/8/8/8/8/8/K7 b' } });
    expect(onChange).toHaveBeenCalledWith({
      placement: 'k7/8/8/8/8/8/8/K7',
      side: 'b',
      castling: '',
      enPassant: '',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the reason inline for an invalid FEN and leaves the position alone', () => {
    const onChange = vi.fn();
    render(<FenField fen={START} onChange={onChange} />);
    const input = screen.getByLabelText('FEN');
    fireEvent.change(input, { target: { value: 'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorId = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(errorId)?.textContent).not.toBe('');
  });

  it('follows outside changes to the position', () => {
    const { rerender } = render(<FenField fen={START} onChange={() => undefined} />);
    rerender(<FenField fen="8/8/8/8/8/8/8/8 w - - 0 1" onChange={() => undefined} />);
    expect(screen.getByLabelText('FEN')).toHaveValue('8/8/8/8/8/8/8/8 w - - 0 1');
  });
});
