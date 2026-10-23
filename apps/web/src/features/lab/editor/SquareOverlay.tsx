import { pieceName, type Armed } from './pieces';

const FILES = 'abcdefgh';

/**
 * While a palette piece (or the eraser) is armed: 64 square buttons over the board, so a click,
 * a tap, or Tab + Enter places it. (Escape, handled by the Lab page, disarms.)
 */
export function SquareOverlay({
  armed,
  orientation,
  onSquare,
}: {
  armed: Exclude<Armed, null>;
  orientation: 'white' | 'black';
  onSquare: (square: string) => void;
}) {
  const squares: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'white' ? col : 7 - col;
      const rank = orientation === 'white' ? 8 - row : row + 1;
      squares.push(`${FILES.charAt(file)}${String(rank)}`);
    }
  }
  const action = armed === 'eraser' ? 'clear' : `place ${pieceName(armed)} on`;
  return (
    <div
      role="group"
      aria-label={armed === 'eraser' ? 'Clear squares' : `Place ${pieceName(armed)}`}
      className="absolute inset-0 z-20 grid grid-cols-8 grid-rows-8 rounded-[3px] ring-4 ring-accent"
    >
      {squares.map((sq) => (
        <button
          key={sq}
          type="button"
          aria-label={
            armed === 'eraser'
              ? `Clear ${sq}`
              : `${action} ${sq}`.replace(/^./, (c) => c.toUpperCase())
          }
          onClick={() => {
            onSquare(sq);
          }}
          className="cursor-crosshair hover:bg-accent/20 focus-visible:bg-accent/25 focus-visible:outline-offset-[-3px]"
        />
      ))}
    </div>
  );
}
