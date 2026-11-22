import type { ErrorResponse, FeedItemListParams, ListParams } from './types';
import { ApiError } from './types';

/** Query-string value accepted by `request`; `null`/`undefined` are dropped. */
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  params?: Record<string, QueryValue>;
  login?: boolean;
}

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

const readJson = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (text.trim().length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const parseError = (payload: unknown): ErrorResponse => {
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const code =
      typeof record.error === 'string' && record.error.length > 0
        ? record.error
        : 'RequestFailed';
    const url = typeof record.url === 'string' ? record.url : undefined;
    return { error: code, url };
  }

  return { error: 'RequestFailed' };
};

const send = async (path: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiError('NetworkError', 0);
  }
};

const unauthorizedError = (payload: unknown, isLogin: boolean): ApiError => {
  if (isLogin) return new ApiError('InvalidCredentials', 401);

  notifyUnauthorized();
  const parsed = parseError(payload);
  return new ApiError(
    parsed.error === 'RequestFailed' ? 'Unauthorized' : parsed.error,
    401,
    parsed.url
  );
};

export const request = async <T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
  };

  if (options.rawBody !== undefined) {
    init.body = options.rawBody;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await send(buildUrl(path, options.params), init);
  const payload = await readJson(response);

  if (response.status === 401) {
    throw unauthorizedError(payload, Boolean(options.login));
  }

  if (!response.ok) {
    const parsed = parseError(payload);
    throw new ApiError(parsed.error, response.status, parsed.url);
  }

  return payload as T;
};

export const pageParams = (params: ListParams): Record<string, QueryValue> => ({
  limit: params.limit,
  unread: params.unread,
  cursor: params.cursor,
});

export const feedItemParams = (
  params: FeedItemListParams
): Record<string, QueryValue> => ({
  ...pageParams(params),
  order: params.order,
});

export const item = <T>(path: string, options?: RequestOptions): Promise<T> =>
  request<{ item: T }>(path, options).then((response) => response.item);
