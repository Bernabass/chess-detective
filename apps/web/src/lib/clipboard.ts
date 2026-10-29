import { useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copies text to the clipboard and reports the outcome for 2.5 seconds ("Copied" / "Couldn't
 * copy"). navigator.clipboard only exists on secure origins (https, localhost).
 */
export function useCopy(): [CopyState, (text: string) => void] {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (text: string): void => {
    const show = (s: CopyState): void => {
      setState(s);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState('idle');
      }, 2500);
    };
    if (!('clipboard' in navigator)) {
      show('failed');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        show('copied');
      },
      () => {
        show('failed');
      },
    );
  };
  return [state, copy];
}
