/** The Lab's example gallery (SPEC §9.3): fixture positions with teaser titles. */
export interface LabExample {
  id: string;
  title: string;
  /** A one-line nudge, without giving the answer away. */
  hint: string;
  fen: string;
  /** What the Lab's analysis says (checked by the e2e tests). */
  verdict: 'illegal' | 'legal' | 'undecided';
}

export const EXAMPLES: readonly LabExample[] = [
  {
    id: 'who-moved-last',
    title: 'Who moved last?',
    hint: "Black's king is boxed in. Which piece could have made the last move, and from where?",
    fen: '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1',
    verdict: 'undecided',
  },
  {
    id: 'impossible-start',
    title: 'The impossible start',
    hint: 'Everything is at home except one white pawn. Where could it have come from?',
    fen: 'rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1',
    verdict: 'illegal',
  },
  {
    id: 'three-pawns-two-files',
    title: 'Three pawns, two files',
    hint: 'Count the files these pawns could have started on.',
    fen: 'k7/8/8/8/8/PP6/PP6/K7 w - - 0 1',
    verdict: 'illegal',
  },
  {
    id: 'walled-in',
    title: 'Walled in',
    hint: 'White has just moved. Which white piece could it have been?',
    fen: '7k/8/8/8/8/8/PPP5/KB6 b - - 0 1',
    verdict: 'illegal',
  },
  {
    id: 'dead-end-two-back',
    title: 'A dead end two moves back',
    hint: "Black's last move is forced. Before it, White had to move. With what?",
    fen: 'r3k2r/pppp1ppp/4p3/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    verdict: 'illegal',
  },
  {
    id: 'checked-by-three',
    title: 'Checked by three',
    hint: 'How many pieces can a single move put into check?',
    fen: '4k3/8/3N4/1B6/8/8/8/4R2K b - - 0 1',
    verdict: 'illegal',
  },
  {
    id: 'count-the-captures',
    title: 'Count the captures',
    hint: "White's d-pawn is still at home, yet a white pawn stands on d5.",
    fen: 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2',
    verdict: 'legal',
  },
  {
    id: 'castled-already',
    title: 'Castled already',
    hint: 'White has castled. How did Black spend the same number of moves?',
    fen: 'r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 4 4',
    verdict: 'legal',
  },
  {
    id: 'two-queens',
    title: 'Two queens, no pawns',
    hint: "One of White's queens can't be the one it started with.",
    fen: '4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1',
    verdict: 'undecided',
  },
  {
    id: 'bishop-ate-the-rook',
    title: 'The bishop that ate the rook',
    hint: "A black bishop stands on f1 and White's king on g1. Press Prove it to see how.",
    fen: 'rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1',
    verdict: 'undecided',
  },
];
