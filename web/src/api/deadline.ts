import { RequestAbortedError } from './types';

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Above the Go server's 60s writeTimeout and 30s foregroundFetchTimeout. */
export const FETCH_TIMEOUT_MS = 90_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

export type RequestDeadline = {
  signal: AbortSignal;
  isCallerAborted: () => boolean;
  isTimedOut: () => boolean;
  cleanup: () => void;
};

export const toAbortError = (cause?: unknown): Error => {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return cause;
  }

  return new RequestAbortedError(cause);
};

export const resolveTimeoutMs = (timeoutMs?: number): number =>
  timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;

export const createRequestDeadline = (
  timeoutMs: number,
  callerSignal?: AbortSignal
): RequestDeadline => {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;

  if (callerSignal?.aborted) {
    callerAborted = true;
    controller.abort(callerSignal.reason);

    return {
      signal: controller.signal,
      isCallerAborted: () => callerAborted,
      isTimedOut: () => timedOut,
      cleanup: () => {},
    };
  }

  const onCallerAbort = (): void => {
    if (timedOut) return;
    callerAborted = true;
    controller.abort(callerSignal?.reason);
  };

  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    if (callerAborted) return;
    timedOut = true;
    controller.abort(new DOMException('Request timed out.', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    isCallerAborted: () => callerAborted,
    isTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
};

const suppressLateRejection = async (
  operation: Promise<unknown>
): Promise<void> => {
  try {
    await operation;
  } catch {
    // Discard rejections after an abort race already settled.
  }
};

export const raceWithAbort = async <T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> => {
  if (signal.aborted) {
    void suppressLateRejection(operation);
    throw signal.reason;
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = (): void => {
      reject(signal.reason);
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } catch (error) {
    if (signal.aborted) {
      void suppressLateRejection(operation);
    }

    throw error;
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
};
