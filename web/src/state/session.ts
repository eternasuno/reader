/**
 * Session state (`AC-AUTH-1..5`). Any non-login `401` flips the client to unauthenticated through
 * the API client's `onUnauthorized` hook, so route guards can redirect to `/login`.
 */

import { createSignal } from 'solid-js';
import { authApi, onUnauthorized } from '../api';

export type SessionStatus = 'checking' | 'authenticated' | 'unauthenticated';

const [sessionStatus, setSessionStatus] =
  createSignal<SessionStatus>('checking');

export { sessionStatus };

export const markAuthenticated = (): void => {
  setSessionStatus('authenticated');
};

export const markUnauthenticated = (): void => {
  setSessionStatus('unauthenticated');
};

/** `AC-AUTH-4`: every guarded route checks the session cookie before rendering. */
export const checkSession = async (): Promise<boolean> => {
  try {
    const session = await authApi.getSession();
    if (session.authenticated) {
      setSessionStatus('authenticated');
      return true;
    }

    setSessionStatus('unauthenticated');
    return false;
  } catch {
    setSessionStatus('unauthenticated');
    return false;
  }
};

/** `AC-AUTH-3`: the caller surfaces a failure inline instead of leaving the page. */
export const signOut = async (): Promise<void> => {
  await authApi.logout();
  setSessionStatus('unauthenticated');
};

onUnauthorized(() => markUnauthenticated());
