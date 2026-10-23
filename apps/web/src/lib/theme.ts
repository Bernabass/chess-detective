import { useEffect, useState } from 'react';

/** The user's choice; "system" follows prefers-color-scheme. Keep in sync with public/theme-init.js. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'retrograde-theme';

export function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Sets data-theme on <html> for a preference. */
export function applyPreference(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && systemIsDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** The current preference and a setter that saves and applies it (and follows system changes). */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    applyPreference(pref);
    if (pref !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyPreference('system');
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [pref]);

  const update = (next: ThemePreference): void => {
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not saved; the choice still applies for this visit.
    }
    setPref(next);
  };
  return [pref, update];
}
