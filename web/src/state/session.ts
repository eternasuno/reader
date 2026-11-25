/**
 * Session state (`AC-AUTH-1..5`). Any non-login `401` flips the client to unauthenticated through
 * the API client's `onUnauthorized` hook, clears session-owned state, and redirects to `/login`.
 */

import { createSignal, untrack } from 'solid-js';
import { ApiError, authApi, errorCodeOf, onUnauthorized } from '../api';
import { setAuthGenerationReader } from '../api/request';

export type SessionStatus =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'error';

const [sessionStatus, setSessionStatus] =
  createSignal<SessionStatus>('checking');
const [sessionErrorCode, setSessionErrorCode] = createSignal<string | null>(
  null
);

export { sessionErrorCode, sessionStatus };

const sessionClearedListeners = new Set<() => void>();

/** Registers a callback invoked whenever the session ends (logout or non-login `401`). */
export const onSessionCleared = (listener: () => void): (() => void) => {
  sessionClearedListeners.add(listener);

  return () => {
    sessionClearedListeners.delete(listener);
  };
};

const notifySessionCleared = (): void => {
  for (const listener of [...sessionClearedListeners]) {
    try {
      listener();
    } catch {
      // A failing listener must never block clearing session state.
    }
  }
};

let sessionEpoch = 0;
let inFlightCheck: Promise<boolean> | null = null;

/** Current authentication generation; advances on every login, logout, or session clear. */
export const sessionGeneration = (): number => sessionEpoch;

setAuthGenerationReader(sessionGeneration);

export const markAuthenticated = (): void => {
  sessionEpoch += 1;
  inFlightCheck = null;
  setSessionErrorCode(null);
  setSessionStatus('authenticated');
};

export const markUnauthenticated = (): void => {
  sessionEpoch += 1;
  inFlightCheck = null;
  setSessionErrorCode(null);
  notifySessionCleared();
  setSessionStatus('unauthenticated');
};

const runSessionCheck = async (startEpoch: number): Promise<boolean> => {
  try {
    const { authenticated } = await authApi.getSession();
    if (sessionEpoch !== startEpoch) {
      return sessionStatus() === 'authenticated';
    }
    if (authenticated) {
      setSessionErrorCode(null);
      setSessionStatus('authenticated');
      return true;
    }

    markUnauthenticated();
    return false;
  } catch (error) {
    if (sessionEpoch !== startEpoch) {
      return sessionStatus() === 'authenticated';
    }
    if (error instanceof ApiError && error.status === 401) {
      markUnauthenticated();
      return false;
    }

    setSessionErrorCode(errorCodeOf(error));
    setSessionStatus('error');
    return false;
  }
};

/**
 * `AC-AUTH-4`: every guarded route checks the session cookie before rendering.
 * Concurrent checks coalesce into one in-flight request.
 */
export const checkSession = (): Promise<boolean> => {
  if (inFlightCheck !== null) return inFlightCheck;

  if (untrack(sessionStatus) === 'error') {
    setSessionErrorCode(null);
    setSessionStatus('checking');
  }

  const pending = runSessionCheck(sessionEpoch).finally(() => {
    if (inFlightCheck === pending) inFlightCheck = null;
  });
  inFlightCheck = pending;
  return pending;
};

/** `AC-AUTH-3`: the caller surfaces a failure inline instead of leaving the page. */
export const signOut = async (): Promise<void> => {
  await authApi.logout();
  markUnauthenticated();
};

onUnauthorized(() => markUnauthenticated());
