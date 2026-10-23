import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { ButtonLink, Card, PageTitle } from './ui';

/** A page whose game data arrives with the server (Phase 7): what it will hold, and where to go now. */
export function Placeholder({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <>
      <PageTitle lead={lead}>{title}</PageTitle>
      <Card className="max-w-2xl">
        <p className="font-display text-lg">This case file is still sealed.</p>
        <p className="mt-2 text-ink-soft">
          It opens when the daily puzzles go live. Until then, the Lab is open: set up any position
          and the engine will tell you what it can deduce about its history.
        </p>
        {children}
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink to="/lab" variant="primary">
            <Icon name="search" className="h-4 w-4" />
            Open the Lab
          </ButtonLink>
          <ButtonLink to="/about">How retrograde analysis works</ButtonLink>
        </div>
      </Card>
    </>
  );
}
