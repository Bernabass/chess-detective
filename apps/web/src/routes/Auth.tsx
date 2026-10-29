import { useId, useState, type InputHTMLAttributes, type SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, PageTitle } from '../components/ui';
import { safeNext } from '../lib/next';
import { errorMessage } from '../lib/problem';
import { useLogin, useRegister } from '../lib/queries';
import { useTitle } from '../lib/useTitle';

function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className="w-full rounded-md border border-card-edge bg-paper px-3 py-2 text-ink"
        {...input}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Sign in and create an account. Afterwards, back to where the player came from (?next=). */
function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const login = mode === 'login';
  const title = login ? 'Sign in' : 'Create an account';
  useTitle(title);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useLogin();
  const register = useRegister();
  const mutation = login ? signIn : register;

  const submit = (e: SyntheticEvent): void => {
    e.preventDefault();
    mutation.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          void navigate(next);
        },
      },
    );
  };

  const otherLink = `${login ? '/register' : '/login'}${
    params.has('next') ? `?next=${encodeURIComponent(next)}` : ''
  }`;

  return (
    <div className="mx-auto max-w-md">
      <PageTitle lead="Keep your streak, appear on the leaderboards and play on any device. Anything you played as a guest on this device comes with you.">
        {title}
      </PageTitle>
      <Card>
        <form className="space-y-4" aria-label={title} onSubmit={submit}>
          <Field
            label="Username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_\-]{3,20}"
            hint={login ? undefined : '3 to 20 letters, digits, _ or -. Shown on leaderboards.'}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={login ? 'current-password' : 'new-password'}
            required
            minLength={login ? 1 : 8}
            maxLength={128}
            hint={login ? undefined : 'At least 8 characters.'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          {mutation.isError && (
            <p role="alert" className="rounded-md border border-bad px-3 py-2 text-sm text-bad">
              {errorMessage(mutation.error)}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending}>
            {login ? 'Sign in' : 'Create account'}
          </Button>
          <Button className="w-full" disabled aria-describedby="lichess-soon">
            Sign in with Lichess
          </Button>
          <p id="lichess-soon" className="-mt-2 text-center text-xs text-ink-soft">
            Sign in with Lichess is coming soon.
          </p>
        </form>
        <p className="mt-4 text-sm text-ink-soft">
          {login ? 'New here? ' : 'Already have an account? '}
          <Link to={otherLink} className="text-ink underline underline-offset-4">
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
