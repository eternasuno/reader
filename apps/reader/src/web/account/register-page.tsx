import { A } from '@solidjs/router';
import { AuthPage } from './auth-page';
import { accountMessages as copy } from './messages';
import { RegisterForm } from './register-form';

/**
 * `/register` (account.md Interface): the card, the form and the link to
 * `/login`. It has no signed-in redirect (AC-SESSION-5).
 */
export const RegisterPage = () => (
  <AuthPage title={copy.registerTitle}>
    <RegisterForm />
    <p class="text-center text-sm text-base-content/70">
      {copy.registerFooterText}{' '}
      <A href="/login" class="link link-neutral">
        {copy.registerFooterLink}
      </A>
    </p>
  </AuthPage>
);
