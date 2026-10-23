import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { useThemePreference, type ThemePreference } from '../lib/theme';
import { Icon, type IconName } from './Icon';

const NAV = [
  { to: '/daily', label: 'Daily' },
  { to: '/lab', label: 'Lab' },
  { to: '/archive', label: 'Archive' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/about', label: 'About' },
] as const;

const THEMES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light theme', icon: 'sun' },
  { value: 'system', label: 'System theme', icon: 'monitor' },
  { value: 'dark', label: 'Dark theme', icon: 'moon' },
];

export function ThemeToggle() {
  const [pref, setPref] = useThemePreference();
  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex rounded-md border border-card-edge bg-card p-0.5"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={pref === t.value}
          title={t.label}
          onClick={() => {
            setPref(t.value);
          }}
          className={`rounded p-1.5 text-ink-soft transition hover:text-ink ${
            pref === t.value ? 'bg-paper text-ink shadow-sm' : ''
          }`}
        >
          <Icon name={t.icon} className="h-4 w-4" title={t.label} />
        </button>
      ))}
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return `rounded-md px-3 py-2 text-sm font-medium no-underline transition ${
    isActive ? 'bg-card-edge/60 text-ink' : 'text-ink-soft hover:text-ink'
  }`;
}

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-rule bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-ink no-underline">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-ink">
            <Icon name="search" className="h-5 w-5" />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Retrograde</span>
        </Link>

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <NavLink
            to="/login"
            className="hidden rounded-md border border-card-edge bg-card px-3 py-1.5 text-sm font-medium text-ink no-underline hover:bg-paper sm:inline-block"
          >
            Sign in
          </NavLink>
          <button
            type="button"
            className="rounded-md p-2 text-ink md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            <Icon name={open ? 'cross' : 'menu'} title={open ? 'Close menu' : 'Open menu'} />
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-rule px-4 py-2 md:hidden">
          <ul className="flex flex-col">
            {[...NAV, { to: '/login', label: 'Sign in' } as const].map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={(s) => `block ${navClass(s)}`}
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
