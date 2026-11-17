import { A, useNavigate } from '@solidjs/router';
import { createEffect } from 'solid-js';
import { authClient } from '../api/auth';
import { AuthPage } from './auth-page';
import { LoginForm } from './login-form';
import { accountMessages as copy } from './messages';

/**
 * `/login` (account.md Interface): the card, the form and the link to
 * `/register`. A signed-in user who opens it goes to `/` (AC-SESSION-5).
 */
export const LoginPage = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();

  createEffect(() => {
    const current = session();

    if (!current.isPending && current.data !== null && current.error === null) {
      navigate('/', { replace: true });
    }
  });

  return (
    <AuthPage title={copy.loginTitle}>
      <LoginForm />
      <p class="text-center text-sm text-base-content/70">
        {copy.loginFooterText}{' '}
        <A href="/register" class="link link-neutral">
          {copy.loginFooterLink}
        </A>
      </p>
    </AuthPage>
  );
};
