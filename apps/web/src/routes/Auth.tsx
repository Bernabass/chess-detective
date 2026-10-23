import { Link } from 'react-router';
import { Button, Card, PageTitle } from '../components/ui';
import { useTitle } from '../lib/useTitle';

function Field({
  id,
  label,
  type,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        disabled
        className="w-full rounded-md border border-card-edge bg-paper px-3 py-2 text-ink disabled:opacity-60"
      />
    </div>
  );
}

/**
 * The sign-in and sign-up layouts, shown now so the design is visible; accounts (and Sign in with
 * Lichess) arrive in Phases 6–8, so the forms are disabled.
 */
function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const login = mode === 'login';
  useTitle(login ? 'Sign in' : 'Create an account');
  return (
    <div className="mx-auto max-w-md">
      <PageTitle lead="Keep your streak, appear on the leaderboards and play on any device.">
        {login ? 'Sign in' : 'Create an account'}
      </PageTitle>
      <Card>
        <p
          role="note"
          className="mb-4 rounded-md border border-card-edge bg-paper px-3 py-2 text-sm text-ink-soft"
        >
          Accounts arrive soon. Until then you can use the Lab without signing in.
        </p>
        <form
          className="space-y-4"
          aria-label={login ? 'Sign in' : 'Create an account'}
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <Field id="username" label="Username" type="text" autoComplete="username" />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete={login ? 'current-password' : 'new-password'}
          />
          <Button type="submit" variant="primary" className="w-full" disabled>
            {login ? 'Sign in' : 'Create account'}
          </Button>
          <Button className="w-full" disabled>
            Sign in with Lichess
          </Button>
        </form>
        <p className="mt-4 text-sm text-ink-soft">
          {login ? 'New here? ' : 'Already have an account? '}
          <Link
            to={login ? '/register' : '/login'}
            className="text-ink underline underline-offset-4"
          >
            {login ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
      </Card>
    </div>
  );
}

export function LoginPage() {
  return <AuthForm mode="login" />;
}

export function RegisterPage() {
  return <AuthForm mode="register" />;
}
