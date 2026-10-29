/** The next puzzle's release: the next UTC midnight after `now` (a day is a UTC day, SPEC §2). */
export function nextPuzzleAt(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

/** The puzzle after the one released on `day` (YYYY-MM-DD, UTC) comes out the next midnight. */
export function nextPuzzleAfter(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
}

/** Time left as h:mm:ss, rounded up to the second (it reads 0:00:00 only when it's time). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

/** An instant as a wall-clock time in the viewer's zone ("09:00"); zone and locale for tests. */
export function localTimeOf(at: Date, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at);
}
