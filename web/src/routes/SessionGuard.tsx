import { useLocation, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import {
  createEffect,
  createSignal,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from 'solid-js';
import { t, translateErrorCode } from '../i18n';
import {
  checkSession,
  sanitizeNextPath,
  sessionErrorCode,
  sessionStatus,
} from '../state';
import { consumeQuickSaveLocation } from '../state/saved-page-create';
import { Button, Icon } from '../ui';

export interface SessionGuardProps {
  children?: JSX.Element;
}

export interface RedirectProps {
  to: string;
}

function GuardChecking(): JSX.Element {
  return (
    <div
      role="status"
      class="flex min-h-dvh items-center justify-center gap-2 bg-base-100 text-sm text-base-content/70"
    >
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
      {t('common.checkingSession')}
    </div>
  );
}

function GuardError(props: { onRetry: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      class="flex min-h-dvh flex-col items-center justify-center gap-3 bg-base-100 px-4 text-center"
    >
      <Icon name="warning" size={24} class="text-error" />
      <p class="text-sm text-base-content/80">
        {translateErrorCode(sessionErrorCode() ?? 'NetworkError')}
      </p>
      <Button variant="secondary" size="sm" onClick={props.onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/**
 * `AC-AUTH-4` / `AC-AUTH-5`: every guarded route verifies the session cookie on entry before
 * revealing contents and forwards unauthenticated visitors to `/login` with a validated relative
 * `?next=` target, keeping the current path and encoded query across sign-in.
 */
export function SessionGuard(props: SessionGuardProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [verified, setVerified] = createSignal(false);

  const currentPath = (): string => `${location.pathname}${location.search}`;

  let active = true;
  onCleanup(() => {
    active = false;
  });

  const verify = (): void => {
    if (untrack(sessionStatus) === 'unauthenticated') return;

    void checkSession().then((ok) => {
      if (active && ok && untrack(sessionStatus) === 'authenticated') {
        setVerified(true);
      }
    });
  };

  onSettled(verify);

  createEffect(
    () => sessionStatus(),
    (status) => {
      if (status !== 'unauthenticated') return;

      const next = untrack(() => {
        const stripped = consumeQuickSaveLocation(
          location.pathname,
          location.search,
          location.hash
        );
        return sanitizeNextPath(stripped ?? currentPath());
      });
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  );

  return (
    <Show
      when={verified() && sessionStatus() === 'authenticated'}
      fallback={
        <Show when={sessionStatus() === 'error'} fallback={<GuardChecking />}>
          <GuardError onRetry={verify} />
        </Show>
      }
    >
      {props.children}
    </Show>
  );
}

/** Redirects to a fixed route on mount, used by `/` and the catch-all route. */
export function Redirect(props: RedirectProps): JSX.Element {
  const navigate = useNavigate();

  createEffect(
    () => props.to,
    (to) => {
      navigate(to, { replace: true });
    }
  );

  return null;
}

/** Wraps a page component in the session guard (`AC-AUTH-4`). */
export function withSession(Child: () => JSX.Element): () => JSX.Element {
  return () => (
    <SessionGuard>
      <Child />
    </SessionGuard>
  );
}
