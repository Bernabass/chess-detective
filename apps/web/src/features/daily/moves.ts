import {
  inCheck,
  initialPosition,
  legalMoves,
  makeMove,
  moveToUci,
  sanToMove,
  sideToMove,
  toFen,
  uciToMove,
  type Position,
} from '@retrograde/engine';
import { proofSteps, type ProofStep } from '../../lib/notation';

// Cheap engine calls on the main thread (web rule): replaying a guess of at most 40 plies and
// listing the legal moves of one position take microseconds.

function positionAfter(moves: readonly string[]): Position {
  const p = initialPosition();
  for (const uci of moves) {
    const r = uciToMove(p, uci);
    if (!r.ok) throw new Error(`illegal move in a guess: ${uci}`);
    makeMove(p, r.value);
  }
  return p;
}

export interface BoardState {
  fen: string;
  turnColor: 'white' | 'black';
  /** Legal destinations by origin square (empty once the guess has all its plies). */
  dests: Map<string, string[]>;
  check: boolean;
  lastMove: [string, string] | null;
  steps: ProofStep[];
  complete: boolean;
  /** Whether from→to is a promotion (the player picks the piece). */
  needsPromotion: (from: string, to: string) => boolean;
}

/** What the board shows for a guess in progress of a `plies`-ply puzzle. */
export function boardState(moves: readonly string[], plies: number): BoardState {
  const p = positionAfter(moves);
  const complete = moves.length >= plies;
  const dests = new Map<string, string[]>();
  const promotions = new Set<string>();
  if (!complete) {
    for (const m of legalMoves(p)) {
      const uci = moveToUci(m);
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      if (uci.length === 5) promotions.add(from + to);
      const list = dests.get(from) ?? [];
      if (!list.includes(to)) list.push(to);
      dests.set(from, list);
    }
  }
  const last = moves.at(-1);
  return {
    fen: toFen(p),
    turnColor: sideToMove(p) === 'w' ? 'white' : 'black',
    dests,
    check: inCheck(p),
    lastMove: last === undefined ? null : [last.slice(0, 2), last.slice(2, 4)],
    steps: proofSteps(moves),
    complete,
    needsPromotion: (from, to) => promotions.has(from + to),
  };
}

export type TypedMove = { ok: true; uci: string } | { ok: false; error: string };

/** A move typed by the player (SAN like "Nf3" or "bxa8=Q", or UCI like "e2e4"). */
export function parseTypedMove(moves: readonly string[], text: string): TypedMove {
  const input = text.trim();
  if (input === '') return { ok: false, error: 'Type a move, like e4, Nf3 or e2e4.' };
  const p = positionAfter(moves);
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(input)) {
    const r = uciToMove(p, input.toLowerCase());
    if (r.ok) return { ok: true, uci: moveToUci(r.value) };
  }
  const san = sanToMove(p, input);
  if (san.ok) return { ok: true, uci: moveToUci(san.value) };
  return { ok: false, error: `"${input}" isn't a legal move here.` };
}

export interface MovesState {
  moves: string[];
  /** The puzzle's length: a guess never gets longer. */
  max: number;
}

export type MovesAction =
  | { type: 'play'; uci: string }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'load'; moves: readonly string[] };

function isLegalAfter(moves: readonly string[], uci: string): boolean {
  return uciToMove(positionAfter(moves), uci).ok;
}

export function movesReducer(state: MovesState, action: MovesAction): MovesState {
  switch (action.type) {
    case 'play':
      if (state.moves.length >= state.max || !isLegalAfter(state.moves, action.uci)) return state;
      return { ...state, moves: [...state.moves, action.uci] };
    case 'undo':
      return { ...state, moves: state.moves.slice(0, -1) };
    case 'reset':
      return { ...state, moves: [] };
    case 'load':
      return { ...state, moves: action.moves.slice(0, state.max) };
  }
}

/** Squares whose contents differ between two piece placements (FEN's first field). */
export function differences(a: string, b: string): string[] {
  const grid = (placement: string): string[] =>
    placement
      .split('/')
      .flatMap((row) => Array.from(row.replace(/\d/g, (d) => '.'.repeat(Number(d)))));
  const ga = grid(a);
  const gb = grid(b);
  const out: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (ga[i] !== gb[i]) out.push(`${'abcdefgh'.charAt(i % 8)}${String(8 - Math.floor(i / 8))}`);
  }
  return out;
}
