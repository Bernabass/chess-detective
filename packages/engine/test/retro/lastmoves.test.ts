import { describe, expect, it } from 'vitest';
import { analyzePosition, lastMoves, type Finding } from '../../src/index';
import { fen } from '../helpers';

const FORCED = '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1';
const BOXED = '7k/8/8/8/8/8/PPP5/KB6 b - - 0 1';
// Black's only last move is ...e7-e6. Before that White must have moved, but the stated
// castling rights freeze White's king and rooks, and every white pawn is still at home.
const DEAD_END = 'r3k2r/pppp1ppp/4p3/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

function ruleFindings(text: string, rule: Finding['rule'], depth = 3): Finding[] {
  const report = analyzePosition(fen(text), { depth });
  return report.verdict.findings.filter((f) => f.rule === rule);
}

describe('lastMoves (SPEC §5.4)', () => {
  it('lists every depth-1 retraction with its viability and a description', () => {
    const r = lastMoves(fen('4k3/8/8/1B6/8/8/8/4K3 b - - 0 1'), { depth: 1 });
    expect(r.status).toBe('complete');
    const capture = r.moves.find((m) => m.move === 'f1b5' && m.uncaptured === 'n');
    expect(capture?.description).toBe(
      "White's last move could have been Bf1xb5, capturing a black knight.",
    );
    expect(capture?.notation).toBe('Bf1xb5');
    expect(capture?.viability).toBe('viable');
    expect(r.moves.find((m) => m.move === 'f1b5' && m.kind === 'normal')?.description).toBe(
      "White's last move could have been Bf1-b5.",
    );
  });

  it('keeps ...e7-e5 after 1.e4 e5 when the FEN writes "-"', () => {
    const r = lastMoves(fen(AFTER_E4_E5), { depth: 3 });
    const e5 = r.moves.find((m) => m.move === 'e7e5');
    expect(e5?.notation).toBe('…e7-e5');
    expect(e5?.viability).toBe('viable');
  });

  it('deeper analysis can rule out moves that look possible at depth 1', () => {
    const shallow = lastMoves(fen(DEAD_END), { depth: 1 });
    expect(shallow.moves.map((m) => [m.move, m.viability])).toEqual([['e7e6', 'viable']]);
    const deep = lastMoves(fen(DEAD_END), { depth: 2 });
    expect(deep.moves.map((m) => [m.move, m.viability])).toEqual([['e7e6', 'not-viable']]);
    expect(deep.moves[0]?.possible).toBe(true); // still possible as a single move
  });

  it('reports unknown viability, never a guess, when a limit stops the search', () => {
    const kiwipete = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b KQkq - 0 1');
    const limited = lastMoves(kiwipete, { depth: 4, nodeLimit: 5 });
    expect(limited.status).toBe('limit');
    expect(limited.moves.some((m) => m.viability === 'unknown')).toBe(true);
    // Depth 1 is always decided.
    expect(limited.moves.every((m) => typeof m.possible === 'boolean')).toBe(true);

    let calls = 0;
    const stopped = lastMoves(kiwipete, { depth: 4, shouldStop: () => ++calls > 3 });
    expect(stopped.status).toBe('aborted');

    const timed = lastMoves(kiwipete, { depth: 6, timeLimitMs: 1 });
    expect(['limit', 'complete']).toContain(timed.status);
  });

  it('counts the work it does', () => {
    const r = lastMoves(fen(AFTER_E4_E5), { depth: 2 });
    expect(r.nodes).toBeGreaterThan(0);
    expect(r.depth).toBe(2);
  });
});

describe('analyzePosition: last-move rules', () => {
  it('NO_POSSIBLE_LAST_MOVE when no retraction passes even at depth 1', () => {
    const report = analyzePosition(fen(BOXED));
    expect(report.verdict.kind).toBe('illegal');
    expect(ruleFindings(BOXED, 'NO_POSSIBLE_LAST_MOVE')[0]?.message).toBe(
      "There's no move White could have just played to reach this position.",
    );
  });

  it('NO_POSSIBLE_HISTORY when every last move leads back to a dead end', () => {
    expect(ruleFindings(DEAD_END, 'NO_POSSIBLE_HISTORY', 1)).toEqual([]);
    const f = ruleFindings(DEAD_END, 'NO_POSSIBLE_HISTORY', 3);
    expect(f[0]?.message).toBe(
      'Every move Black could have just played leads back to a position with no possible last move (checked 3 moves deep).',
    );
    expect(analyzePosition(fen(DEAD_END), { depth: 3 }).verdict.kind).toBe('illegal');
  });

  it('LAST_MOVE_FORCED names the move and every piece it could have captured', () => {
    const f = ruleFindings(FORCED, 'LAST_MOVE_FORCED', 1);
    expect(f[0]?.message).toBe(
      "Black's last move must have been …Kh8-g8, possibly capturing a white knight, bishop, rook or queen.",
    );
    expect(f[0]?.arrows).toEqual([['h8', 'g8']]);
    expect(ruleFindings(DEAD_END, 'LAST_MOVE_FORCED', 1)[0]?.message).toBe(
      "Black's last move must have been …e7-e6.",
    );
  });

  it('never presents a move as en passant when it may have been an ordinary capture', () => {
    const f = ruleFindings('8/8/3Pk3/2p5/8/8/PPP5/KB6 b - - 0 1', 'LAST_MOVE_FORCED');
    expect(f[0]?.message).toBe(
      "White's last move must have been e5xd6, capturing a black pawn (possibly en passant), knight, bishop, rook or queen.",
    );
  });

  it('LAST_MOVE_FORCED stays silent when two different moves are possible', () => {
    expect(ruleFindings(AFTER_E4_E5, 'LAST_MOVE_FORCED', 1)).toEqual([]);
    expect(ruleFindings('4k3/8/8/1B6/8/8/8/4K3 b - - 0 1', 'LAST_MOVE_FORCED', 2)).toEqual([]);
  });

  it('claims nothing when the search hits a limit', () => {
    const report = analyzePosition(fen(DEAD_END), { depth: 3, nodeLimit: 0 });
    expect(report.verdict.findings.map((f) => f.rule)).not.toContain('NO_POSSIBLE_HISTORY');
    expect(report.verdict.findings.map((f) => f.rule)).not.toContain('LAST_MOVE_FORCED');
    expect(report.verdict).toMatchObject({ kind: 'undecided', reason: 'search-limit' });
  });

  it('the initial position is legal with an empty proof', () => {
    const report = analyzePosition(fen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
    expect(report.verdict).toMatchObject({ kind: 'legal', proof: [] });
  });

  it('a reachable position is legal, with its shortest proof (SPEC §5.1)', () => {
    const report = analyzePosition(fen(AFTER_E4_E5));
    expect(report.verdict).toMatchObject({ kind: 'legal', proof: ['e2e4', 'e7e5'] });
    expect(report.lastMoves.moves.some((m) => m.move === 'e7e5')).toBe(true);
  });

  it('stays undecided when no proof fits the quick attempt, saying why', () => {
    // Bare kings need a long proof game: the lower bound alone exceeds 10 plies.
    expect(analyzePosition(fen('8/8/8/8/8/8/8/K6k w - - 0 1')).verdict).toMatchObject({
      kind: 'undecided',
      reason: 'no-contradiction-found',
    });
    // Disabled, or cut short by its node limit.
    expect(analyzePosition(fen(AFTER_E4_E5), { proofMaxPlies: 0 }).verdict).toMatchObject({
      kind: 'undecided',
      reason: 'no-contradiction-found',
    });
    const castled = 'r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 4 4';
    expect(analyzePosition(fen(castled), { proofNodeLimit: 1 }).verdict).toMatchObject({
      kind: 'undecided',
      reason: 'search-limit',
    });
  });

  it('a proof honours the stated castling rights and en passant square', () => {
    const r = analyzePosition(fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'));
    expect(r.verdict).toMatchObject({ kind: 'legal', proof: ['e2e4'] });
  });
});
