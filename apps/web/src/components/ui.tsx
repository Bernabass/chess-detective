import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 border border-transparent',
  secondary: 'bg-card text-ink border border-card-edge hover:bg-paper',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-card-edge/50',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  to,
  variant = 'secondary',
  className = '',
  children,
}: {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`${BASE} ${VARIANTS[variant]} no-underline ${className}`}>
      {children}
    </Link>
  );
}

/** A "case file": the paper card most content sits on. */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
  labelledBy,
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  labelledBy?: string;
  /** No padding: the content (a table, a list) runs to the edges. */
  flush?: boolean;
}) {
  return (
    <Tag
      aria-labelledby={labelledBy}
      className={`rounded-lg border border-card-edge bg-card shadow-card ${
        flush ? 'overflow-hidden' : 'p-4 sm:p-5'
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Small-caps label above a card's content, like a file tab. */
export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="mb-3 font-sans text-xs font-semibold tracking-[0.14em] text-brass uppercase"
    >
      {children}
    </h2>
  );
}

export function PageTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">{children}</h1>
      {lead !== undefined && <p className="mt-2 max-w-2xl text-ink-soft">{lead}</p>}
    </header>
  );
}
