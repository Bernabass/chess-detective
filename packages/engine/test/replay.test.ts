import { describe, expect, it } from 'vitest';
import { checkers, legalMoves, replay, toFen } from '../src/index';

// Games and expected final FENs built with python-chess 1.11.2 (en passant written after
// every double push, as our toFen does).
const GAMES = [
  {
    name: 'white O-O, black O-O-O, en passant for both sides, capture-promotion to a knight',
    ucis: 'e2e4 d7d5 e4e5 f7f5 e5f6 b8c6 f6g7 d8d6 g7h8n c8d7 g1f3 e8c8 f1b5 d5d4 e1g1 e7e5 c2c4 d4c3',
    fen: '2kr1bnN/pppb3p/2nq4/1B2p3/8/2p2N2/PP1P1PPP/RNBQ1RK1 w - - 0 10',
  },
  {
    name: 'black capture-promotion to a knight',
    ucis: 'a2a3 b7b5 b1c3 b5b4 c3b1 b4a3 b1c3 a3b2 a1b1 b2c1n',
    fen: 'rnbqkbnr/p1pppppp/8/8/8/2N5/2PPPPPP/1RnQKBNR w Kkq - 0 6',
  },
  {
    name: 'white capture-promotion to a rook',
    ucis: 'h2h4 g7g5 h4g5 h7h6 g5h6 g8f6 h6h7 f6g8 h7g8r',
    fen: 'rnbqkbRr/pppppp2/8/8/8/8/PPPPPPP1/RNBQKBNR b KQkq - 0 5',
  },
  {
    name: 'white O-O-O, black O-O',
    ucis: 'd2d4 g8f6 c1f4 g7g6 b1c3 f8g7 d1d2 e8g8 e1c1',
    fen: 'rnbq1rk1/ppppppbp/5np1/8/3P1B2/2N5/PPPQPPPP/2KR1BNR b - - 5 5',
  },
  {
    name: 'checkmate as the last move',
    ucis: 'e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7',
    fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',
  },
  {
    name: 'discovered double check',
    ucis: 'f2f3 b8a6 e2e4 b7b6 e1e2 d7d5 e2d3 e7e5 c2c4 d5e4',
    fen: 'r1bqkbnr/p1p2ppp/np6/4p3/2P1p3/3K1P2/PP1P2PP/RNBQ1BNR w kq - 0 6',
  },
  {
    name: 'white capture-promotion to a bishop, black quiet promotion to a queen',
    ucis:
      'e2e3 g7g5 h2h4 f7f6 a2a3 a7a6 h4g5 b7b5 e3e4 h7h6 g5h6 b5b4 d2d4 e7e5 d4d5 b4a3 h1h4 ' +
      'a6a5 c2c3 d7d6 f2f3 c7c6 b2b4 c6c5 a1a2 a5a4 h4h1 c5b4 c3b4 e8d7 a2b2 f6f5 b2f2 f5e4 ' +
      'g2g4 d8e8 f1e2 e4e3 h6h7 e5e4 h7g8b e8d8 d1c2 c8b7 f2g2 a3a2 b4b5 a2a1q',
    fen: 'rn1q1bBr/1b1k4/3p4/1P1P4/p3p1P1/4pP2/2Q1B1R1/qNB1K1NR w - - 0 25',
  },
];

describe('replay', () => {
  it.each(GAMES)('$name', ({ ucis, fen }) => {
    const r = replay(ucis.split(' '));
    if (!r.ok) throw new Error(`illegal at ${String(r.error.illegalAt)}: ${r.error.reason}`);
    expect(toFen(r.value)).toBe(fen);
  });

  it('ends in mate and double check where expected', () => {
    const mate = replay(GAMES[4]?.ucis.split(' ') ?? []);
    const double = replay(GAMES[5]?.ucis.split(' ') ?? []);
    if (!mate.ok || !double.ok) throw new Error('fixture games must replay');
    expect(legalMoves(mate.value)).toHaveLength(0);
    expect(checkers(mate.value)).toHaveLength(1);
    expect(checkers(double.value)).toHaveLength(2);
  });

  it('replays the empty game to the start position', () => {
    const r = replay([]);
    expect(r.ok && toFen(r.value)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it.each([
    [['e2e4', 'e7e5', 'e1g1'], 2, /illegal/i],
    [['e2e4', 'e2e4'], 1, /illegal/i],
    [['e2e4', 'e7e5', 'g1f3', 'xx'], 3, /malformed/i],
    [['e7e5'], 0, /illegal/i],
    [['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'g8f6', 'h6h7', 'f6g8', 'h7g8'], 8, /promotion/i],
  ])('reports %j as illegal at ply %i', (moves, index, reason) => {
    const r = replay(moves);
    if (r.ok) throw new Error('expected an illegal move');
    expect(r.error.illegalAt).toBe(index);
    expect(r.error.reason).toMatch(reason);
  });
});
