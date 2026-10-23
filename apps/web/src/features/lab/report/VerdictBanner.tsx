import type { Verdict } from '@retrograde/engine';
import { Icon, type IconName } from '../../../components/Icon';
import { keepEllipsis } from '../../../lib/notation';
import { verdictReason } from './verdict';

interface Look {
  word: string;
  icon: IconName;
  tone: string;
}

const LOOKS: Record<Verdict['kind'], Look> = {
  illegal: { word: 'Illegal', icon: 'cross', tone: 'border-bad text-bad' },
  legal: { word: 'Legal (proved)', icon: 'check', tone: 'border-ok text-ok' },
  undecided: { word: 'Undecided', icon: 'question', tone: 'border-warn text-warn' },
};

/** Illegal / Legal (proved) / Undecided, always as icon + word + colour (never colour alone). */
export function VerdictBanner({ verdict, busy = false }: { verdict: Verdict; busy?: boolean }) {
  const look = LOOKS[verdict.kind];
  return (
    <div
      className={`rounded-lg border-l-4 bg-paper px-4 py-3 ${look.tone} ${busy ? 'opacity-60' : ''}`}
      data-verdict={verdict.kind}
    >
      <p className="flex items-center gap-2 font-display text-2xl font-semibold">
        <Icon name={look.icon} className="h-6 w-6" />
        <span>{look.word}</span>
      </p>
      <p className="mt-1 text-ink">{keepEllipsis(verdictReason(verdict))}</p>
    </div>
  );
}
