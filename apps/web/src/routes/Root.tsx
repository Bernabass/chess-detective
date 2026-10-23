import type { ReactNode } from 'react';
import { Outlet, ScrollRestoration, isRouteErrorResponse, useRouteError } from 'react-router';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { ButtonLink, Card } from '../components/ui';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}

/** The layout every page shares: header, main content, footer. */
export function Root() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Shown when a page fails to load or throws. */
export function RootError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong.';
  return (
    <Shell>
      <Card>
        <h1 className="text-2xl font-semibold">This page tripped over a clue</h1>
        <p className="mt-2 text-ink-soft">{message}</p>
        <ButtonLink to="/" className="mt-4">
          Back to the start
        </ButtonLink>
      </Card>
    </Shell>
  );
}
