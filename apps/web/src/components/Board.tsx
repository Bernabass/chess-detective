import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Key, MouchEvent, Piece } from 'chessground/types';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { describePlacement } from '../lib/notation';

export interface BoardProps {
  /** Placement or full FEN. */
  fen: string;
  orientation?: 'white' | 'black';
  /** Free editing: drag pieces anywhere, drag off the board to delete. */
  editable?: boolean;
  /** New placement after an edit on the board. */
  onEdit?: (placement: string) => void;
  /** Squares to highlight (detective notes). */
  highlights?: readonly string[];
  arrows?: readonly (readonly [string, string])[];
  lastMove?: readonly [string, string] | null;
  /** Accessible name, e.g. "Lab board". The pieces are described in words after it. */
  label: string;
  /** A thumbnail inside something that already names it (a gallery link): hidden from assistive tech. */
  decorative?: boolean;
  coordinates?: boolean;
}

export interface BoardHandle {
  /** Starts dragging a new piece onto the board (the editor's palette). */
  dragNewPiece: (piece: Piece, event: MouchEvent) => void;
  /** Puts a piece on a square (click-to-place from the palette). */
  setPiece: (square: string, piece: Piece | null) => void;
}

const BRUSHES = {
  // Used for detective-note arrows; readable on both board themes.
  note: { key: 'note', color: '#b3382f', opacity: 0.85, lineWidth: 12 },
};

/**
 * The chessground wrapper (web rule: created once per mount, updated with set(), destroyed on
 * unmount). The board itself is an image to assistive technology; its pieces are described in
 * words, and every editing action has a keyboard alternative outside the board.
 */
export const Board = forwardRef<BoardHandle, BoardProps>(function Board(
  {
    fen,
    orientation = 'white',
    editable = false,
    onEdit,
    highlights = [],
    arrows = [],
    lastMove = null,
    label,
    coordinates = true,
    decorative = false,
  },
  ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const placement = fen.split(' ')[0] ?? '';
  // Compare by content: callers often pass fresh (equal) arrays, and every set() redraws the
  // board (and would drop a piece being dragged).
  const highlightKey = highlights.join(' ');
  const lastMoveKey = lastMove === null ? '' : `${lastMove[0]}${lastMove[1]}`;
  const arrowKey = arrows.map(([a, b]) => `${a}${b}`).join(' ');

  const config = useMemo((): Config => {
    const squares = highlightKey === '' ? [] : highlightKey.split(' ');
    const custom = new Map<Key, string>(squares.map((sq) => [sq as Key, 'note-highlight']));
    return {
      fen: placement,
      orientation,
      coordinates,
      viewOnly: !editable,
      lastMove:
        lastMoveKey === ''
          ? undefined
          : [lastMoveKey.slice(0, 2) as Key, lastMoveKey.slice(2, 4) as Key],
      highlight: { lastMove: true, check: false, custom },
      movable: { free: editable, color: editable ? 'both' : undefined, showDests: false },
      draggable: { enabled: editable, deleteOnDropOff: editable, showGhost: true },
      selectable: { enabled: editable },
      premovable: { enabled: false },
      // The board never plays real moves: a king dragged two squares must not take its rook along.
      autoCastle: false,
      drawable: { enabled: false, visible: true },
      animation: { enabled: true, duration: 180 },
    };
  }, [placement, orientation, editable, coordinates, lastMoveKey, highlightKey]);

  const shapes = useMemo(
    (): DrawShape[] =>
      (arrowKey === '' ? [] : arrowKey.split(' ')).map((a) => ({
        orig: a.slice(0, 2) as Key,
        dest: a.slice(2, 4) as Key,
        brush: 'note',
      })),
    [arrowKey],
  );

  // The config at creation time: chessground draws coordinates only when it's created.
  const initial = useRef(config);
  initial.current = config;

  useEffect(() => {
    const el = element.current;
    if (el === null) return;
    const cg = Chessground(el, {
      ...initial.current,
      drawable: { enabled: false, visible: true, brushes: BRUSHES as unknown as DrawBrushes },
      events: {
        change: () => {
          onEditRef.current?.(cg.getFen());
        },
      },
    });
    api.current = cg;
    return () => {
      cg.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.set(config);
  }, [config]);

  useEffect(() => {
    api.current?.setAutoShapes(shapes);
  }, [shapes]);

  useImperativeHandle(
    ref,
    () => ({
      dragNewPiece: (piece, event) => {
        api.current?.dragNewPiece(piece, event, true);
      },
      setPiece: (square, piece) => {
        const cg = api.current;
        if (cg === null) return;
        cg.setPieces(new Map([[square as Key, piece ?? undefined]]));
        onEditRef.current?.(cg.getFen());
      },
    }),
    [],
  );

  return (
    <div
      className="board-frame"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${label}. ${describePlacement(placement)}`}
      aria-hidden={decorative ? true : undefined}
    >
      <div ref={element} />
    </div>
  );
});
