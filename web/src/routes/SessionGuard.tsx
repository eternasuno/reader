import { useLocation, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import { createEffect, Show, untrack } from 'solid-js';
import { t } from '../i18n';
import { checkSession, sanitizeNextPath, sessionStatus } from '../state';

export interface SessionGuardProps {
  children?: JSX.Element;
}

export interface RedirectProps {
  to: string;
}

/**
 * `AC-AUTH-4` / `AC-AUTH-5`: every guarded route verifies the session cookie before rendering and
 * forwards unauthenticated visitors to `/login` with a validated relative `?next=` target, keeping
 * the current path and encoded query (for example `/save?url=...`) across the sign-in.
 */
export function SessionGuard(props: SessionGuardProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const currentPath = (): string => `${location.pathname}${location.search}`;

  createEffect(
    () => sessionStatus(),
    (status) => {
      if (status === 'checking') void checkSession();
    }
  );

  createEffect(
    () => sessionStatus(),
    (status) => {
      if (status !== 'unauthenticated') return;

      const next = untrack(() => sanitizeNextPath(currentPath()));
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  );

  return (
    <Show
      when={sessionStatus() === 'authenticated'}
      fallback={
        <div
          role="status"
          class="flex min-h-dvh items-center justify-center gap-2 bg-base-100 text-sm text-base-content/70"
        >
          <span class="loading loading-spinner loading-sm" aria-hidden="true" />
          {String(t('common.checkingSession'))}
        </div>
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
