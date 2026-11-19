import { useLocation, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import { createEffect, createSignal, onSettled, Show, untrack } from 'solid-js';
import { authApi } from '../api';
import { t, toggleLocale, translateErrorCode } from '../i18n';
import {
  checkSession,
  markAuthenticated,
  sanitizeNextPath,
  sessionStatus,
} from '../state';
import { Button, Input } from '../ui';
import { errorCodeOf } from './viewHelpers';

function LoginBrand(): JSX.Element {
  return (
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col">
        <p class="text-xs tracking-wide text-base-content/60 uppercase">
          {String(t('auth.productLabel'))}
        </p>
        <p class="text-2xl font-semibold text-brand">
          {String(t('common.brand'))}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-label={String(t('common.localeSwitchLabel'))}
        onClick={toggleLocale}
      >
        {String(t('common.localeToggleShort'))}
      </Button>
    </div>
  );
}

/** `auth.md`: password failures stay inline; a rate limit is reported separately. */
function LoginError(props: { code: string }): JSX.Element {
  return (
    <div role="alert" class="alert alert-error alert-soft text-sm">
      {props.code === 'REQUIRED'
        ? String(t('auth.passwordRequired'))
        : translateErrorCode(props.code)}
    </div>
  );
}

interface LoginFormProps {
  password: string;
  submitting: boolean;
  onPassword: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
}

function LoginForm(props: LoginFormProps): JSX.Element {
  let form: HTMLFormElement | undefined;

  onSettled(() => {
    form?.querySelector<HTMLInputElement>('input[type="password"]')?.focus();
  });

  return (
    <form ref={form} class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        type="password"
        autocomplete="current-password"
        required
        label={String(t('auth.passwordLabel'))}
        placeholder={String(t('auth.passwordPlaceholder'))}
        value={props.password}
        disabled={props.submitting}
        onInput={(event) => props.onPassword(event.currentTarget.value)}
      />
      <Button
        type="submit"
        variant="primary"
        class="w-full"
        loading={props.submitting}
        disabled={props.submitting}
      >
        {String(t(props.submitting ? 'auth.submitting' : 'auth.submit'))}
      </Button>
    </form>
  );
}

/** `auth.md:15,29-49`: keeps `?next` across a failed attempt and redirects once authenticated. */
const useLoginRedirects = (nextParam: () => string | null): void => {
  const navigate = useNavigate();

  createEffect(
    () => sessionStatus(),
    (status) => {
      if (status === 'checking') void checkSession();
    }
  );

  createEffect(
    () => sessionStatus(),
    (status) => {
      if (status !== 'authenticated') return;

      const target = untrack(() => sanitizeNextPath(nextParam()));
      navigate(target, { replace: true });
    }
  );
};

const useLoginSubmit = (nextParam: () => string | null) => {
  const navigate = useNavigate();
  const [password, setPassword] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  // Keep the code, not the translated text, so a locale switch re-translates the message.
  const [errorCode, setErrorCode] = createSignal<string | null>(null);

  const attempt = async (value: string): Promise<void> => {
    // Resolve the destination before the guard effect reacts to `markAuthenticated()`.
    const destination = untrack(() => sanitizeNextPath(nextParam()));
    setSubmitting(true);
    setErrorCode(null);

    try {
      await authApi.login(value);
      markAuthenticated();
      navigate(destination, { replace: true });
    } catch (caught) {
      setErrorCode(errorCodeOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (submitting()) return;

    const value = password();
    if (value.length === 0) {
      setErrorCode('REQUIRED');
      return;
    }

    void attempt(value);
  };

  return { password, setPassword, submitting, errorCode, submit };
};

/**
 * `auth.md:15,29-49`: centered single-password sign-in card. `?next` is validated through
 * `sanitizeNextPath`, survives failed attempts, and is honored once the session is authenticated.
 */
export function LoginPage(): JSX.Element {
  const location = useLocation();
  const nextParam = (): string | null =>
    new URLSearchParams(location.search).get('next');
  const login = useLoginSubmit(nextParam);

  useLoginRedirects(nextParam);

  return (
    <div class="flex min-h-dvh items-center justify-center bg-base-100 p-4">
      <div class="card w-full max-w-sm border border-base-300 bg-base-200 shadow-xl">
        <div class="card-body gap-5">
          <LoginBrand />
          <h1 class="text-lg font-medium">{String(t('auth.title'))}</h1>
          <Show when={login.errorCode()}>
            {(code) => <LoginError code={code()} />}
          </Show>
          <LoginForm
            password={login.password()}
            submitting={login.submitting()}
            onPassword={login.setPassword}
            onSubmit={login.submit}
          />
        </div>
      </div>
    </div>
  );
}
