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
  /** Squares outlined by the daily game's difference overlay. */
  marks?: readonly string[];
  /** Playing real moves (the daily game): only legal destinations, the side to move's pieces. */
  play?: BoardPlay;
}

export interface BoardPlay {
  turnColor: 'white' | 'black';
  /** Legal destinations by origin square; empty when no move may be played. */
  dests: ReadonlyMap<string, readonly string[]>;
  check: boolean;
  onMove: (from: string, to: string) => void;
}

export interface BoardHandle {
  /** Starts dragging a new piece onto the board (the editor's palette). */
  dragNewPiece: (piece: Piece, event: MouchEvent) => void;
  /** Puts a piece on a square (click-to-place from the palette). */
  setPiece: (square: string, piece: Piece | null) => void;
  /** Redraws the board from its props (after a move the parent didn't accept, e.g. a cancelled promotion). */
  sync: () => void;
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
    marks = [],
    play,
  },
  ref,
) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onMoveRef = useRef(play?.onMove);
  onMoveRef.current = play?.onMove;

  const placement = fen.split(' ')[0] ?? '';
  // Compare by content: callers often pass fresh (equal) arrays, and every set() redraws the
  // board (and would drop a piece being dragged).
  const highlightKey = highlights.join(' ');
  const lastMoveKey = lastMove === null ? '' : `${lastMove[0]}${lastMove[1]}`;
  const arrowKey = arrows.map(([a, b]) => `${a}${b}`).join(' ');
  const markKey = marks.join(' ');
  const turnColor = play?.turnColor;
  const check = play?.check ?? false;
  const destsKey =
    play === undefined
      ? ''
      : [...play.dests].map(([from, tos]) => `${from}:${tos.join(',')}`).join(' ');

  const config = useMemo((): Config => {
    const squares = highlightKey === '' ? [] : highlightKey.split(' ');
    const custom = new Map<Key, string>(squares.map((sq) => [sq as Key, 'note-highlight']));
    for (const sq of markKey === '' ? [] : markKey.split(' ')) {
      custom.set(sq as Key, custom.has(sq as Key) ? 'note-highlight diff-mark' : 'diff-mark');
    }
    const playing = turnColor !== undefined;
    const dests = new Map<Key, Key[]>(
      (destsKey === '' ? [] : destsKey.split(' ')).map((entry) => {
        const [from = '', tos = ''] = entry.split(':');
        return [from as Key, tos.split(',') as Key[]];
      }),
    );
    if (playing) {
      return {
        fen: placement,
        orientation,
        coordinates,
        viewOnly: false,
        turnColor,
        check: check ? turnColor : false,
        lastMove:
          lastMoveKey === ''
            ? undefined
            : [lastMoveKey.slice(0, 2) as Key, lastMoveKey.slice(2, 4) as Key],
        highlight: { lastMove: true, check: true, custom },
        movable: { free: false, color: turnColor, dests, showDests: true },
        draggable: { enabled: true, deleteOnDropOff: false, showGhost: true },
        selectable: { enabled: true },
        premovable: { enabled: false },
        // Castling is a king move of two squares here (UCI e1g1); the next position moves the rook.
        autoCastle: true,
        drawable: { enabled: false, visible: true },
        animation: { enabled: true, duration: 180 },
      };
    }
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
  }, [
    placement,
    orientation,
    editable,
    coordinates,
    lastMoveKey,
    highlightKey,
    markKey,
    turnColor,
    check,
    destsKey,
  ]);

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
  const configRef = useRef(config);
  configRef.current = config;

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
      movable: {
        ...initial.current.movable,
        events: {
          after: (orig, dest) => {
            onMoveRef.current?.(orig, dest);
          },
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
        const cg = api.current;
        if (cg === null) return;
        cg.state.dom.bounds.clear(); // see remeasure()
        cg.dragNewPiece(piece, event, true);
      },
      setPiece: (square, piece) => {
        const cg = api.current;
        if (cg === null) return;
        cg.setPieces(new Map([[square as Key, piece ?? undefined]]));
        onEditRef.current?.(cg.getFen());
      },
      sync: () => {
        api.current?.set(configRef.current);
      },
    }),
    [],
  );

  // chessground caches the board's screen position and refreshes it on scroll and resize only.
  // Layout shifts without either (web fonts loading, content above the board changing) would
  // make it map the pointer to the wrong square, so remeasure whenever a pointer goes down.
  const remeasure = (): void => {
    api.current?.state.dom.bounds.clear();
  };

  return (
    <div
      onPointerDownCapture={remeasure}
      className="board-frame"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${label}. ${describePlacement(placement)}`}
      aria-hidden={decorative ? true : undefined}
    >
      <div ref={element} />
    </div>
  );
});
