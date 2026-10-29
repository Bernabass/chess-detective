// Small display formats for the daily game, built from code points so the source has no
// characters that tools could mangle.
export const STAR = String.fromCodePoint(0x2605); // ★
export const DOT = String.fromCodePoint(0x00b7); // ·
export const ELLIPSIS = String.fromCodePoint(0x2026); // …

/** "★★★" for difficulty 3. */
export function stars(difficulty: number): string {
  return STAR.repeat(Math.max(0, Math.min(5, difficulty)));
}

/** Move-count notation (SPEC §2): 9 plies is "4.5 moves", 8 plies "4.0 moves". */
export function movesLabel(plies: number): string {
  return `${(plies / 2).toFixed(1)} moves`;
}

/** "4.5 moves · 9 plies" (SPEC §8.1). */
export function lengthLabel(plies: number): string {
  return `${movesLabel(plies)} ${DOT} ${String(plies)} ${plies === 1 ? 'ply' : 'plies'}`;
}

/** A solve time: "0:42", "12:05", or "1:02:05" once it passes an hour (people leave tabs open). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(seconds)}`
    : `${String(minutes)}:${two(seconds)}`;
}

/** A spoken version of formatDuration for screen readers: "1 hour 2 minutes 5 seconds". */
export function describeDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const parts: [number, string][] = [
    [Math.floor(s / 3600), 'hour'],
    [Math.floor((s % 3600) / 60), 'minute'],
    [s % 60, 'second'],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`);
  return words.length === 0 ? '0 seconds' : words.join(' ');
}
