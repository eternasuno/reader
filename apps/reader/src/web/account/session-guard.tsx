import { Navigate, type RouteSectionProps, useNavigate } from '@solidjs/router';
import { Match, onCleanup, onMount, Switch } from 'solid-js';
import { authClient } from '../api/auth';
import { onUnauthorized } from '../api/client';
import { sessionMessages } from '../api/messages';

type SessionState = 'pending' | 'failed' | 'signed-out' | 'signed-in';

/**
 * The one guard of every protected route (AC-SESSION-4, AC-SESSION-6): while the
 * session check runs it shows the checking text, when the check fails it shows
 * the failure text and does not redirect, an answered "no session" redirects to
 * `/login` replacing the entry, and otherwise the route renders. It also
 * registers the reaction to a 401 from any API call: the same redirect.
 */
export const SessionGuard = (props: RouteSectionProps) => {
  const navigate = useNavigate();
  const session = authClient.useSession();

  onMount(() => {
    onCleanup(onUnauthorized(() => navigate('/login', { replace: true })));
  });

  /** Better Auth re-reads the session on focus and after sign-in and sign-out. */
  const state = (): SessionState => {
    const current = session();

    if (current.isPending) return 'pending';
    if (current.data !== null) return 'signed-in';

    return current.error === null ? 'signed-out' : 'failed';
  };

  return (
    <Switch fallback={props.children}>
      <Match when={state() === 'pending'}>
        <p class="grid min-h-screen place-items-center bg-base-200 text-base-content/70">
          {sessionMessages.checking}
        </p>
      </Match>
      <Match when={state() === 'failed'}>
        <div class="grid min-h-screen place-items-center bg-base-200 p-6">
          <p role="alert" class="alert alert-error">
            {sessionMessages.failed}
          </p>
        </div>
      </Match>
      <Match when={state() === 'signed-out'}>
        <Navigate href="/login" />
      </Match>
    </Switch>
  );
};
