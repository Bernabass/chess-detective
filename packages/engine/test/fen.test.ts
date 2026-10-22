import { describe, expect, it } from 'vitest';
import {
  initialPosition,
  parseFen,
  pieceAt,
  sideToMove,
  squareFromName,
  targetKey,
  toFen,
  type FenError,
  type Position,
} from '../src/index';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function mustParse(fen: string): Position {
  const r = parseFen(fen);
  if (!r.ok) throw new Error(`expected ${fen} to parse: ${JSON.stringify(r.error)}`);
  return r.value;
}

function errorsOf(fen: string): FenError[] {
  const r = parseFen(fen);
  if (r.ok) throw new Error(`expected ${fen} to fail`);
  return r.error;
}

describe('parseFen / toFen', () => {
  it('parses the start position and matches initialPosition()', () => {
    const p = mustParse(START);
    expect(toFen(p)).toBe(START);
    expect(toFen(initialPosition())).toBe(START);
    expect(sideToMove(p)).toBe('w');
    expect(pieceAt(p, squareFromName('e1'))).toBe('K');
    expect(pieceAt(p, squareFromName('d8'))).toBe('q');
    expect(pieceAt(p, squareFromName('e4'))).toBeNull();
  });

  it.each([
    START,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    '8/8/8/8/8/8/8/K6k b - - 99 150',
    '4k3/8/8/8/8/8/8/4K3 w Kq - 0 1',
  ])('round-trips canonical FEN %s', (fen) => {
    expect(toFen(mustParse(fen))).toBe(fen);
  });

  it('defaults the clocks for a 4-field FEN and canonicalises whitespace', () => {
    expect(toFen(mustParse('  8/8/8/8/8/8/8/K6k   w  -  - '))).toBe('8/8/8/8/8/8/8/K6k w - - 0 1');
  });

  it('accepts an en passant square on the wrong rank for the side to move (syntax only)', () => {
    const text = '4k3/8/8/8/8/8/8/4K3 w - d3 0 1';
    expect(toFen(mustParse(text))).toBe(text);
  });

  it('rejects look-alike piece letters such as the Kelvin sign', () => {
    const kelvin = String.fromCharCode(0x212a); // a "K" look-alike that lowercases to "k"
    expect(errorsOf(`8/8/8/8/8/8/8/${kelvin}6k w - - 0 1`).map((e) => e.field)).toEqual([
      'placement',
    ]);
  });

  it('canonicalises split empty-square digits', () => {
    expect(toFen(mustParse('44/8/8/8/8/8/8/K6k w - - 0 1'))).toBe('8/8/8/8/8/8/8/K6k w - - 0 1');
  });

  it.each([
    ['k7/8/8/8/8/8/8/K6P w - - 0 1', 'pawn on the back rank'],
    ['KK6/8/8/8/8/8/8/k7 w - - 0 1', 'two white kings'],
    ['8/8/8/8/8/8/8/8 w - - 0 1', 'no kings at all'],
    ['4k3/4R3/8/8/8/8/8/4K3 w - - 0 1', 'side not to move is in check'],
    ['4k3/8/8/8/8/8/8/5K1R w K - 0 1', 'castling right without king on e1'],
    ['4k3/8/8/8/8/8/8/4K3 w - e6 0 1', 'en passant square with no pawn'],
    [
      'QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQK w - - 0 1',
      '64 pieces',
    ],
  ])('parses the syntactically valid but illegal %s (%s)', (fen) => {
    expect(toFen(mustParse(fen))).toBe(fen);
  });

  it.each<[string, FenError['field']]>([
    ['', 'fields'],
    ['8/8/8/8/8/8/8/K6k w -', 'fields'],
    ['8/8/8/8/8/8/8/K6k w - - 0', 'fields'],
    ['8/8/8/8/8/8/8/K6k w - - 0 1 extra', 'fields'],
    ['8/8/8/8/8/8/K6k w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/8/K6k w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K6kp w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K5k w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K6x w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K06k w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K9 w - - 0 1', 'placement'],
    ['8/8/8/8/8/8/8/K6k x - - 0 1', 'side'],
    ['8/8/8/8/8/8/8/K6k w qK - 0 1', 'castling'],
    ['8/8/8/8/8/8/8/K6k w KK - 0 1', 'castling'],
    ['8/8/8/8/8/8/8/K6k w A - 0 1', 'castling'],
    ['8/8/8/8/8/8/8/K6k w - e4 0 1', 'enPassant'],
    ['8/8/8/8/8/8/8/K6k w - i6 0 1', 'enPassant'],
    ['8/8/8/8/8/8/8/K6k w - - -1 1', 'halfmove'],
    ['8/8/8/8/8/8/8/K6k w - - x 1', 'halfmove'],
    ['8/8/8/8/8/8/8/K6k w - - 0 1.5', 'fullmove'],
    ['8/8/8/8/8/8/8/K6k w - - 0 99999999999', 'fullmove'],
  ])('rejects %j with a %s error', (fen, field) => {
    expect(errorsOf(fen).map((e) => e.field)).toContain(field);
  });

  it('reports every broken field at once', () => {
    const fields = errorsOf('8/8/8/8/8/8/8/K6k x KK e4 a b').map((e) => e.field);
    expect(fields).toEqual(['side', 'castling', 'enPassant', 'halfmove', 'fullmove']);
  });

  it('gives each error a readable message', () => {
    for (const e of errorsOf('8/8/8/8/8/8/8/K6x x - - 0 1')) {
      expect(e.message.length).toBeGreaterThan(10);
    }
  });
});

describe('targetKey', () => {
  it('is placement plus side to move only', () => {
    expect(
      targetKey(mustParse('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2')),
    ).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w');
    expect(targetKey(mustParse('8/8/8/8/8/8/8/K6k b - - 7 40'))).toBe('8/8/8/8/8/8/8/K6k b');
  });
});
