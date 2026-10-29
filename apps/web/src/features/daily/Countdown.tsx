import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { formatRemaining, localTimeOf, nextPuzzleAfter } from './nextPuzzle';

/**
 * Time until the puzzle after `day` comes out (the next UTC midnight after that day), with that
 * moment in the viewer's own time. Counting from the puzzle's day, not the clock's, a daily
 * finished after midnight (or reopened later) says at once that the next one is out. It ticks
 * every second but isn't a live region, so screen readers aren't interrupted.
 */
export function Countdown({ day, onReady }: { day: string; onReady: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const target = nextPuzzleAfter(day);

  const remaining = target.getTime() - now.getTime();
  const ready = remaining <= 0;

  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [ready]);

  if (ready) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium">A new puzzle is ready.</p>
        <Button variant="primary" onClick={onReady}>
          Play today's puzzle
        </Button>
      </div>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Icon name="clock" className="h-4 w-4 text-ink-soft" />
      <span>Next puzzle in</span>
      <span role="timer" aria-live="off" className="font-mono text-lg font-medium tabular-nums">
        {formatRemaining(remaining)}
      </span>
      <span className="text-ink-soft">(at {localTimeOf(target)} your time)</span>
    </p>
  );
}
