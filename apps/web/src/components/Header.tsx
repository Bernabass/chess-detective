import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe } from '../lib/queries';
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

/**
 * Who's playing: "Sign in" for guests (with or without a guest session), the username and Sign
 * out for an account. Unknown (API down) reads as a guest.
 */
function Account({ onNavigate, inMenu = false }: { onNavigate?: () => void; inMenu?: boolean }) {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const username = me.data !== undefined && !me.data.guest ? me.data.username : undefined;
  const pill =
    'rounded-md border border-card-edge bg-card px-3 py-1.5 text-sm font-medium text-ink no-underline hover:bg-paper';

  if (username === undefined) {
    const here = pathname.startsWith('/login') || pathname.startsWith('/register');
    return (
      <NavLink
        to={here ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`}
        onClick={onNavigate}
        className={inMenu ? (s) => `block ${navClass(s)}` : pill}
      >
        Sign in
      </NavLink>
    );
  }
  return (
    <div className={inMenu ? 'flex flex-col' : 'flex items-center gap-2'}>
      <NavLink
        to={`/u/${encodeURIComponent(username)}`}
        onClick={onNavigate}
        className={
          inMenu ? (s) => `block ${navClass(s)}` : `${pill} inline-flex items-center gap-1.5`
        }
      >
        <Icon name="user" className="h-4 w-4" />
        <span className="max-w-32 truncate">{username}</span>
      </NavLink>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => {
          logout.mutate(undefined, {
            onSuccess: () => {
              onNavigate?.();
              void navigate('/');
            },
          });
        }}
        className={
          inMenu
            ? `text-left ${navClass({ isActive: false })}`
            : `${pill} inline-flex items-center gap-1.5`
        }
      >
        <Icon name="logout" className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

/** On a phone the account lives in the menu; a signed-in player still sees who they are. */
function MobileUser() {
  const me = useMe();
  const username = me.data !== undefined && !me.data.guest ? me.data.username : undefined;
  if (username === undefined) return null;
  return (
    <Link
      to={`/u/${encodeURIComponent(username)}`}
      aria-label={`Signed in as ${username}`}
      className="rounded-md p-2 text-ink sm:hidden"
    >
      <Icon name="user" className="h-5 w-5" />
    </Link>
  );
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
          <div className="hidden sm:block">
            <Account />
          </div>
          <MobileUser />
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
            {NAV.map((item) => (
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
            <li className="sm:hidden">
              <Account
                inMenu
                onNavigate={() => {
                  setOpen(false);
                }}
              />
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
