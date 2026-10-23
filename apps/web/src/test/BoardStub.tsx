import { forwardRef, useImperativeHandle } from 'react';
import type { BoardHandle, BoardProps } from '../components/Board';

/**
 * Board stand-in for component tests (chessground needs layout that jsdom doesn't have). It
 * exposes what the board would show as data attributes.
 */
export const BoardStub = forwardRef<BoardHandle, BoardProps>(function BoardStub(props, ref) {
  useImperativeHandle(
    ref,
    () => ({ dragNewPiece: () => undefined, setPiece: () => undefined }),
    [],
  );
  return (
    <div
      role="img"
      aria-label={props.label}
      data-fen={props.fen}
      data-highlights={(props.highlights ?? []).join(' ')}
      data-arrows={(props.arrows ?? []).map(([a, b]) => `${a}${b}`).join(' ')}
    />
  );
});
