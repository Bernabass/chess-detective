import type { IconName } from '../../components/Icon';

/** The three feedback kinds (SPEC §8.3): colour, icon and words always together. */
export const FEEDBACK: Record<
  'G' | 'Y' | 'X',
  { icon: IconName; label: string; long: string; className: string }
> = {
  G: {
    icon: 'check',
    label: 'right move, right ply',
    long: 'Right move at the right ply.',
    className: 'bg-hit text-hit-ink',
  },
  Y: {
    icon: 'swap',
    label: 'right move, another ply',
    long: 'Right move, but it belongs at another ply of the same side.',
    className: 'bg-near text-near-ink',
  },
  X: {
    icon: 'cross',
    label: 'not in the solution',
    long: "This move isn't in the solution.",
    className: 'bg-miss text-miss-ink',
  },
};

/** Counts for an announcement: "3 right, 2 in another ply, 3 not in the solution". */
export function summarize(feedback: string): string {
  const count = (k: string): number => Array.from(feedback).filter((c) => c === k).length;
  const parts = [
    `${String(count('G'))} right`,
    `${String(count('Y'))} in another ply`,
    `${String(count('X'))} not in the solution`,
  ];
  return parts.join(', ');
}
