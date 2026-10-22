/**
 * Perft reference counts from chessprogramming.org "Perft Results" (checked 2026-10-22).
 * `fast` is the deepest depth with at most ~500,000 nodes (SPEC §4.7).
 */
export interface PerftCase {
  name: string;
  fen: string;
  counts: readonly number[]; // counts[d - 1] = nodes at depth d
  fast: number;
}

export const PERFT_CASES: readonly PerftCase[] = [
  {
    name: 'start',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    counts: [20, 400, 8902, 197281, 4865609, 119060324],
    fast: 4,
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603, 193690690],
    fast: 3,
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624],
    fast: 4,
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333, 15833292],
    fast: 4,
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487, 89941194],
    fast: 3,
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890, 3894594, 164075551],
    fast: 3,
  },
];
