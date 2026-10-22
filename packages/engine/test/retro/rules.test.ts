import { describe, expect, it } from 'vitest';
import { staticFindings, type Finding, type RuleId } from '../../src/index';
import { fen } from '../helpers';

function findings(text: string): Finding[] {
  return staticFindings(fen(text));
}

function rules(text: string): RuleId[] {
  return findings(text).map((f) => f.rule);
}

function only(text: string, rule: RuleId): Finding[] {
  return findings(text).filter((f) => f.rule === rule);
}

/** Positions that occur in real games: no static rule may call them illegal. */
const REAL = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
  'rnbqkbn1/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQq - 0 1',
];

describe('static rules stay silent on real positions', () => {
  it.each(REAL)('%s has no illegal findings', (text) => {
    expect(findings(text).filter((f) => f.severity === 'illegal')).toEqual([]);
  });
});

describe('KING_COUNT', () => {
  it('fires for two kings and for no king', () => {
    expect(only('KK6/8/8/8/8/8/8/k7 w - - 0 1', 'KING_COUNT')[0]?.message).toBe(
      'White has 2 kings. Each side has exactly one king.',
    );
    const none = only('8/8/8/8/8/8/8/k7 w - - 0 1', 'KING_COUNT');
    expect(none.map((f) => f.message)).toEqual([
      'White has no king. Each side has exactly one king.',
    ]);
  });
});

describe('PAWN_ON_BACK_RANK', () => {
  it('fires for each pawn on rank 1 or 8', () => {
    const f = only('k7/8/8/8/8/8/8/K6P w - - 0 1', 'PAWN_ON_BACK_RANK');
    expect(f.map((x) => x.message)).toEqual([
      'The white pawn on h1 is impossible: pawns never stand on the first or last rank.',
    ]);
    expect(f[0]?.squares).toEqual(['h1']);
    expect(only('k6p/8/8/8/8/8/8/K7 b - - 0 1', 'PAWN_ON_BACK_RANK')).toHaveLength(1);
  });
});

describe('TOO_MANY_PIECES and TOO_MANY_PAWNS', () => {
  it('fires for 17 pieces', () => {
    expect(
      only('rnbqkbnr/pppppppp/n7/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'TOO_MANY_PIECES')[0]
        ?.message,
    ).toBe('Black has 17 pieces but started with 16.');
  });

  it('fires for 9 pawns', () => {
    expect(only('k7/8/8/8/8/P7/PPPPPPPP/K7 w - - 0 1', 'TOO_MANY_PAWNS')[0]?.message).toBe(
      'White has 9 pawns but started with 8.',
    );
  });
});

describe('PROMOTION_EXCESS and PROMOTED_PIECE_REQUIRED', () => {
  it('fires when promoted pieces plus pawns exceed 8', () => {
    expect(only('4k3/8/8/8/8/8/PPPPPPPP/QQ2K3 w - - 0 1', 'PROMOTION_EXCESS')[0]?.message).toBe(
      'White has 2 queens, so at least 1 is a promoted pawn. With 8 pawns still on the board that makes 9 pawns, but White only had 8.',
    );
  });

  it('counts bishops by square colour', () => {
    // c1 and e1 are both dark squares.
    expect(rules('k7/8/8/8/8/8/PPPPPPPP/K1B1B3 w - - 0 1')).toContain('PROMOTION_EXCESS');
    expect(
      only('k7/8/8/8/8/8/PPPPPPP1/K1B1B3 w - - 0 1', 'PROMOTED_PIECE_REQUIRED')[0]?.message,
    ).toBe('At least 1 white piece is a promoted pawn: White has 2 dark-squared bishops.');
    // c1 dark, f1 light: the normal pair.
    expect(rules('k7/8/8/8/8/8/PPPPPPPP/K1B2B2 w - - 0 1')).not.toContain(
      'PROMOTED_PIECE_REQUIRED',
    );
  });

  it('is a deduction, not an error, when there are pawns to spare', () => {
    const f = only('4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1', 'PROMOTED_PIECE_REQUIRED');
    expect(f[0]?.severity).toBe('deduction');
    expect(f[0]?.message).toBe('At least 1 white piece is a promoted pawn: White has 2 queens.');
    expect(rules('4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1')).not.toContain('PROMOTION_EXCESS');
  });
});

describe('OPPONENT_IN_CHECK', () => {
  it('fires when the side that just moved is in check', () => {
    const f = only('4k3/4R3/8/8/8/8/8/4K3 w - - 0 1', 'OPPONENT_IN_CHECK');
    expect(f[0]?.message).toBe(
      "It's White to move, but the black king on e8 is in check from the rook on e7. Black's last move would have left its own king in check.",
    );
    expect(f[0]?.squares).toEqual(['e8', 'e7']);
  });

  it('is silent when the side to move is the one in check', () => {
    expect(rules('4k3/4R3/8/8/8/8/8/4K3 b - - 0 1')).not.toContain('OPPONENT_IN_CHECK');
  });
});

describe('TOO_MANY_CHECKERS', () => {
  it('fires for a triple check', () => {
    const f = only('4k3/8/3N4/1B6/8/8/8/4R2K b - - 0 1', 'TOO_MANY_CHECKERS');
    expect(f[0]?.message).toBe(
      'The black king is in check from 3 pieces at once; one move can create at most a double check.',
    );
  });

  it('allows a double check', () => {
    expect(rules('4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1')).not.toContain('TOO_MANY_CHECKERS');
  });
});

describe('PAWN_STRUCTURE_IMPOSSIBLE', () => {
  it('names the unmatched pawn and its blocking group', () => {
    const f = only('k7/8/8/8/8/PP6/PP6/K7 w - - 0 1', 'PAWN_STRUCTURE_IMPOSSIBLE');
    expect(f[0]?.message).toBe(
      '3 white pawns (a2, b2, a3) could only have started on the a- and b-files, so the pawn on a3 has no possible starting file.',
    );
    expect(f[0]?.squares).toEqual(['a2', 'b2', 'a3']);
  });
});

describe('PAWN_CAPTURES_EXCEED_MISSING and CAPTURES_REQUIRED', () => {
  it('fires when pawn captures exceed the missing enemy pieces', () => {
    const f = only(
      'rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1',
      'PAWN_CAPTURES_EXCEED_MISSING',
    );
    expect(f[0]?.message).toBe(
      "White's pawns needed at least 1 capture to get where they are, but all 16 black pieces are still on the board.",
    );
    expect(f[0]?.squares).toEqual(['c3']);
  });

  it('is a deduction when enough enemy pieces are missing', () => {
    const text = 'rnbqkbn1/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQq - 0 1';
    expect(rules(text)).not.toContain('PAWN_CAPTURES_EXCEED_MISSING');
    expect(only(text, 'CAPTURES_REQUIRED')[0]?.message).toBe(
      "White's pawns made at least 1 capture.",
    );
  });

  it('stays silent when every pawn is on its own file', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(rules(start)).not.toContain('CAPTURES_REQUIRED');
    expect(rules(start)).not.toContain('PAWN_CAPTURES_EXCEED_MISSING');
  });

  it('says how many pieces are missing when some are', () => {
    const f = only(
      'rnbqkbn1/pppppppp/8/8/8/1PP5/2PPPPPP/RNBQKBNR b KQq - 0 1',
      'PAWN_CAPTURES_EXCEED_MISSING',
    );
    expect(f[0]?.message).toBe(
      "White's pawns needed at least 2 captures to get where they are, but Black is missing only 1 piece.",
    );
  });
});

describe('CASTLING_RIGHTS_INCONSISTENT and CASTLING_LOST', () => {
  it('fires when the king or rook of a claimed right has moved', () => {
    expect(only('4k3/8/8/8/8/8/8/5K1R w K - 0 1', 'CASTLING_RIGHTS_INCONSISTENT')[0]?.message).toBe(
      'The FEN says White can castle kingside, but the white king is on f1.',
    );
    expect(only('r3k3/8/8/8/8/8/8/4K3 w k - 0 1', 'CASTLING_RIGHTS_INCONSISTENT')[0]?.message).toBe(
      'The FEN says Black can castle kingside, but there is no black rook on h8.',
    );
  });

  it('notes lost rights as deductions', () => {
    const f = only('r3k2r/8/8/8/8/8/8/R4K1R w kq - 0 1', 'CASTLING_LOST');
    expect(f.map((x) => x.message)).toEqual([
      'White can no longer castle kingside: the white king has left e1.',
      'White can no longer castle queenside: the white king has left e1.',
    ]);
    expect(only('4k2r/8/8/8/8/8/8/4K3 w k - 0 1', 'CASTLING_LOST').map((x) => x.message)).toContain(
      'Black can no longer castle queenside: the a8 rook has moved or been captured.',
    );
    expect(rules('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).not.toContain(
      'CASTLING_LOST',
    );
  });
});

describe('EN_PASSANT_INCONSISTENT', () => {
  it.each([
    [
      '4k3/8/8/8/8/8/8/4K3 w - e6 0 1',
      'The FEN gives e6 as the en passant square, so Black just played e7-e5, but there is no black pawn on e5.',
    ],
    [
      '4k3/4p3/8/4p3/8/8/8/4K3 w - e6 0 1',
      'The FEN gives e6 as the en passant square, so Black just played e7-e5, but e7 is occupied.',
    ],
    [
      '4k3/8/8/8/4P3/8/8/4K3 w - e3 0 1',
      "The FEN gives e3 as the en passant square, which means White just double-pushed a pawn, but it's White to move.",
    ],
  ])('fires for %s', (text, message) => {
    expect(only(text, 'EN_PASSANT_INCONSISTENT')[0]?.message).toBe(message);
  });

  it('accepts a consistent en passant square', () => {
    expect(rules('4k3/8/8/4p3/8/8/8/4K3 w - e6 0 1')).not.toContain('EN_PASSANT_INCONSISTENT');
  });
});
