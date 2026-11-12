import { Schema } from 'effect';
import type { LibraryErrorTag } from './library-error';
import { isLibraryErrorTag, LibraryError } from './library-error';

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type LibraryClientOptions = {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
};

export type RequestOptions = {
  readonly method: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly noStore?: boolean;
};

export type Send = (path: string, options: RequestOptions) => Promise<unknown>;

const textField = (body: object, key: string): string | undefined => {
  const value = Reflect.get(body, key);

  return typeof value === 'string' ? value : undefined;
};

const bodyText = async (response: Response): Promise<unknown> => {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new LibraryError('NetworkError');
  }

  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new LibraryError('InvalidResponse');
  }
};

const responseTag = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  return textField(body, '_tag') ?? textField(body, 'error');
};

const statusTag = (status: number): LibraryErrorTag => {
  if (status === 401) {
    return 'Unauthorized';
  }

  return status === 403 ? 'Forbidden' : 'RequestFailed';
};

const responseError = async (response: Response): Promise<LibraryError> => {
  const body = await bodyText(response).catch(() => undefined);
  const tag = responseTag(body) ?? statusTag(response.status);
  const detail =
    typeof body === 'object' && body !== null
      ? { id: textField(body, 'id'), url: textField(body, 'url') }
      : {};

  return new LibraryError(
    isLibraryErrorTag(tag) ? tag : 'RequestFailed',
    detail
  );
};

const queryString = (
  query: Readonly<Record<string, string | undefined>> | undefined
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  const text = params.toString();

  return text === '' ? '' : `?${text}`;
};

export const decodeBody = async <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  body: unknown
): Promise<S['Type']> => {
  try {
    return await Schema.decodeUnknownPromise(schema)(body);
  } catch {
    throw new LibraryError('InvalidResponse');
  }
};

const baseUrl = (options: LibraryClientOptions): string =>
  options.baseUrl ?? globalThis.location?.origin ?? '';

export const createSend = (options: LibraryClientOptions): Send => {
  const fetchImpl: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return async (path, init) => {
    const url = `${baseUrl(options)}${path}${queryString(init.query)}`;
    const payload =
      init.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init.body),
          };
    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: init.method,
        credentials: 'include',
        ...(init.noStore === true ? { cache: 'no-store' as const } : {}),
        ...payload,
      });
    } catch {
      throw new LibraryError('NetworkError');
    }

    if (!response.ok) {
      throw await responseError(response);
    }

    return bodyText(response);
  };
};

export const sendGet = (
  send: Send,
  path: string,
  query?: Readonly<Record<string, string | undefined>>
): Promise<unknown> =>
  send(path, {
    method: 'GET',
    noStore: true,
    ...(query === undefined ? {} : { query }),
  });

export const sendJson = (
  send: Send,
  path: string,
  body: unknown
): Promise<unknown> => send(path, { method: 'POST', body });
