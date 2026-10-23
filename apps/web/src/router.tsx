import type { RouteObject } from 'react-router';
import { Root, RootError } from './routes/Root';

/**
 * Every route (SPEC §12, Phase 5). Pages load lazily, so the Lab's board and engine code aren't
 * part of the first download on other pages.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Root,
    ErrorBoundary: RootError,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./routes/Home')).HomePage }) },
      {
        path: 'lab',
        lazy: async () => ({ Component: (await import('./features/lab/LabPage')).LabPage }),
      },
      {
        path: 'about',
        lazy: async () => ({ Component: (await import('./routes/About')).AboutPage }),
      },
      {
        path: 'daily',
        lazy: async () => ({ Component: (await import('./routes/Daily')).DailyPage }),
      },
      {
        path: 'daily/:number',
        lazy: async () => ({ Component: (await import('./routes/Daily')).DailyPage }),
      },
      {
        path: 'archive',
        lazy: async () => ({ Component: (await import('./routes/Placeholders')).ArchivePage }),
      },
      {
        path: 'leaderboard',
        lazy: async () => ({ Component: (await import('./routes/Placeholders')).LeaderboardPage }),
      },
      {
        path: 'u/:username',
        lazy: async () => ({ Component: (await import('./routes/Placeholders')).ProfilePage }),
      },
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('./routes/Auth')).LoginPage }),
      },
      {
        path: 'register',
        lazy: async () => ({ Component: (await import('./routes/Auth')).RegisterPage }),
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('./routes/NotFound')).NotFoundPage }),
      },
    ],
  },
];
