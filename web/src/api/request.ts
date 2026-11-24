import {
  createRequestDeadline,
  type RequestDeadline,
  raceWithAbort,
  resolveTimeoutMs,
  toAbortError,
} from './deadline';
import type { Decoder, TypeGuard } from './decoders';
import { decodeItem } from './decoders';
import type { ErrorResponse, ListParams, RequestCallOptions } from './types';
import { ApiError, RequestTimeoutError } from './types';

/** Query-string value accepted by `request`; `null`/`undefined` are dropped. */
type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = RequestCallOptions & {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  params?: Record<string, QueryValue>;
  login?: boolean;
};

let readAuthGeneration: () => number = () => 0;

/** Registers a session generation reader so stale `401`s never clear a newer session. */
export const setAuthGenerationReader = (reader: () => number): void => {
  readAuthGeneration = reader;
};

const unauthorizedListeners = new Set<() => void>();

export const onUnauthorized = (listener: () => void): (() => void) => {
  unauthorizedListeners.add(listener);

  return () => {
    unauthorizedListeners.delete(listener);
  };
};

const notifyUnauthorized = () => {
  for (const listener of [...unauthorizedListeners]) {
    try {
      listener();
    } catch {
      // A failing listener must never block the request pipeline.
    }
  }
};

const buildUrl = (
  path: string,
  params?: Record<string, QueryValue>
): string => {
  if (!params) return path;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length > 0 ? `${path}?${query}` : path;
};

const throwDeadlineOrNetworkError = (
  deadline: RequestDeadline,
  callerSignal: AbortSignal | undefined,
  cause?: unknown
): never => {
  if (deadline.isCallerAborted()) {
    throw toAbortError(callerSignal?.reason ?? cause);
  }

  if (deadline.isTimedOut()) {
    throw new RequestTimeoutError();
  }

  throw new ApiError('NetworkError', 0);
};

const awaitWithDeadline = async <T>(
  run: () => Promise<T>,
  deadline: RequestDeadline,
  callerSignal?: AbortSignal
): Promise<T> => {
  let value: T;
  try {
    value = await raceWithAbort(run(), deadline.signal);
  } catch (error) {
    return throwDeadlineOrNetworkError(deadline, callerSignal, error);
  }

  if (deadline.isCallerAborted() || deadline.isTimedOut()) {
    return throwDeadlineOrNetworkError(deadline, callerSignal);
  }

  return value;
};

const readBodyText = (
  response: Response,
  deadline: RequestDeadline,
  callerSignal?: AbortSignal
): Promise<string> =>
  awaitWithDeadline(() => response.text(), deadline, callerSignal);

const parseJsonSafely = (text: string): unknown => {
  if (text.trim().length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const nonEmptyString = (
  record: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = record[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const parseError = (payload: unknown): ErrorResponse => {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return { error: 'RequestFailed' };
  }

  const record = payload as Record<string, unknown>;

  return {
    error: nonEmptyString(record, 'error') ?? 'RequestFailed',
    url: typeof record.url === 'string' ? record.url : undefined,
    id: nonEmptyString(record, 'id'),
  };
};

const buildRequestInit = (
  options: RequestOptions,
  signal: AbortSignal
): RequestInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    signal,
  };

  if (options.rawBody !== undefined) {
    init.body = options.rawBody;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  return init;
};

const send = (
  url: string,
  init: RequestInit,
  deadline: RequestDeadline,
  callerSignal?: AbortSignal
): Promise<Response> =>
  awaitWithDeadline(() => fetch(url, init), deadline, callerSignal);

const unauthorizedError = (
  payload: unknown,
  isLogin: boolean,
  isCurrentGeneration: boolean
): ApiError => {
  if (isLogin) return new ApiError('InvalidCredentials', 401);

  if (isCurrentGeneration) notifyUnauthorized();
  const parsed = parseError(payload);
  return new ApiError(
    parsed.error === 'RequestFailed' ? 'Unauthorized' : parsed.error,
    401,
    parsed.url,
    parsed.id
  );
};

const readErrorPayload = async (
  response: Response,
  deadline: RequestDeadline,
  callerSignal?: AbortSignal
): Promise<unknown> => {
  try {
    const text = await readBodyText(response, deadline, callerSignal);
    return parseJsonSafely(text);
  } catch (error) {
    if (deadline.isCallerAborted()) {
      throw toAbortError(callerSignal?.reason ?? error);
    }

    // Known 401 still triggers unauthorized/login error handling even if the body stream fails.
    if (response.status === 401) {
      return undefined;
    }

    throw error;
  }
};

const throwErrorResponse = async (
  response: Response,
  options: RequestOptions,
  authGeneration: number,
  deadline: RequestDeadline
): Promise<never> => {
  const payload = await readErrorPayload(response, deadline, options.signal);

  if (response.status === 401) {
    throw unauthorizedError(
      payload,
      Boolean(options.login),
      authGeneration === readAuthGeneration()
    );
  }

  const parsed = parseError(payload);
  throw new ApiError(parsed.error, response.status, parsed.url, parsed.id);
};

const executeRequest = async <T>(
  path: string,
  options: RequestOptions,
  handleOk: (response: Response, deadline: RequestDeadline) => Promise<T>
): Promise<T> => {
  if (options.signal?.aborted) {
    throw toAbortError(options.signal.reason);
  }

  const deadline = createRequestDeadline(
    resolveTimeoutMs(options.timeoutMs),
    options.signal
  );
  try {
    const authGeneration = readAuthGeneration();
    const url = buildUrl(path, options.params);
    const init = buildRequestInit(options, deadline.signal);
    const response = await send(url, init, deadline, options.signal);
    if (!response.ok) {
      return await throwErrorResponse(
        response,
        options,
        authGeneration,
        deadline
      );
    }

    return await handleOk(response, deadline);
  } finally {
    deadline.cleanup();
  }
};

export const request = async <T>(
  path: string,
  decode: Decoder<T>,
  options: RequestOptions = {}
): Promise<T> =>
  await executeRequest(path, options, async (response, deadline) => {
    if (response.status === 204) {
      throw new ApiError('InvalidResponse', response.status);
    }

    const text = await readBodyText(response, deadline, options.signal);
    if (text.trim().length === 0) {
      throw new ApiError('InvalidResponse', response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError('InvalidResponse', response.status);
    }

    return decode(payload, response.status);
  });

export const requestNoContent = async (
  path: string,
  options: RequestOptions = {},
  expectedStatus = 204
): Promise<void> =>
  await executeRequest(path, options, async (response) => {
    if (response.status !== expectedStatus) {
      throw new ApiError('InvalidResponse', response.status);
    }
  });

export const pageParams = (params: ListParams): Record<string, QueryValue> => ({
  limit: params.limit,
  unread: params.unread,
  cursor: params.cursor,
  order: params.order,
});

export const item = async <T>(
  path: string,
  guard: TypeGuard<T>,
  options?: RequestOptions
): Promise<T> => await request(path, decodeItem(guard), options);
