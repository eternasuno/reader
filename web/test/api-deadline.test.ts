import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  authApi,
  errorCodeOf,
  feedsApi,
  foldersApi,
  onUnauthorized,
  RequestTimeoutError,
  savedPagesApi,
  settingsApi,
} from '../src/api';
import {
  DEFAULT_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from '../src/api/deadline';
import { request } from '../src/api/request';
import { jsonResponse } from './support/state-fixture';

let fetchMock: ReturnType<typeof vi.fn>;

const neverSettlingResponse = (status = 200): Response => {
  const response = new Response(null, { status });
  vi.spyOn(response, 'text').mockImplementation(() => new Promise(() => {}));

  return response;
};

const unreadableResponse = (status: number): Response => {
  const response = new Response('ignored', { status });
  vi.spyOn(response, 'text').mockRejectedValue(new TypeError('stream failed'));

  return response;
};

const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;

    return undefined;
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEADLINE_CASES: Array<[() => Promise<unknown>, number]> = [
  [() => authApi.getSession(), DEFAULT_TIMEOUT_MS],
  [() => savedPagesApi.create('https://example.com/a'), FETCH_TIMEOUT_MS],
  [
    () =>
      feedsApi.importOpml(
        new File(['<opml/>'], 'a.opml', { type: 'text/xml' })
      ),
    UPLOAD_TIMEOUT_MS,
  ],
];

describe('request initialization', () => {
  it('cleans up the deadline when serialization throws', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const body: { self?: unknown } = {};
    body.self = body;

    await expect(
      request('/test', () => undefined, { body, signal: controller.signal })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
  });
});

describe('request timeouts', () => {
  it('rejects with RequestTimeoutError when fetch exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const settled = captureError(feedsApi.list({ timeoutMs: 250 }));
    await vi.advanceTimersByTimeAsync(250);

    const error = await settled;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toMatchObject({ name: 'AbortError' });
    expect(errorCodeOf(error)).toBe('RequestTimeout');
    expect(unauthorized).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('rejects with RequestTimeoutError when reading response body stalls', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(neverSettlingResponse(200));

    const settled = captureError(settingsApi.get({ timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);

    const error = await settled;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toMatchObject({ name: 'AbortError' });
    expect(errorCodeOf(error)).toBe('RequestTimeout');
  });

  it('applies bounded default, fetch, and upload deadlines', async () => {
    vi.useFakeTimers();
    const pending = Symbol('pending');

    for (const [run, expectedMs] of DEADLINE_CASES) {
      fetchMock.mockImplementationOnce(() => new Promise(() => {}));
      const settled = captureError(run());
      await vi.advanceTimersByTimeAsync(expectedMs - 1);
      await expect(
        Promise.race([settled, Promise.resolve(pending)])
      ).resolves.toBe(pending);
      await vi.advanceTimersByTimeAsync(1);
      expect(await settled).toBeInstanceOf(RequestTimeoutError);
    }
  });
});

describe('external AbortSignal', () => {
  it('rejects immediately without calling fetch when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort('cancelled');

    const error = await captureError(
      feedsApi.list({ signal: controller.signal })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(error).not.toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('aborts in-flight fetch and stays distinct from timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const settled = captureError(
      savedPagesApi.list({}, { signal: controller.signal, timeoutMs: 1_000 })
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    const error = await settled;
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(error).not.toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('external AbortSignal vs response and timeout', () => {
  it('aborts in-flight 401 body read without triggering onUnauthorized', async () => {
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(neverSettlingResponse(401));

    const settled = captureError(feedsApi.list({ signal: controller.signal }));
    await Promise.resolve();
    controller.abort();

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(unauthorized).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps timeout as RequestTimeoutError if caller aborts afterwards', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const settled = captureError(
      foldersApi.list({ signal: controller.signal, timeoutMs: 50 })
    );
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();

    const error = await settled;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toMatchObject({ name: 'AbortError' });
  });
});

describe('401 handling with empty, unreadable, or non-JSON bodies', () => {
  it.each([
    ['null empty body', () => new Response(null, { status: 401 })],
    ['empty JSON body', () => jsonResponse({}, 401)],
    ['blank text body', () => new Response('   ', { status: 401 })],
    [
      'non-JSON body',
      () => new Response('<html>Denied</html>', { status: 401 }),
    ],
    ['unreadable body', () => unreadableResponse(401)],
  ])('triggers onUnauthorized for %s', async (_, makeResponse) => {
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    fetchMock.mockResolvedValueOnce(makeResponse());

    await expect(feedsApi.list()).rejects.toMatchObject({
      code: 'Unauthorized',
      status: 401,
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('handles 401 as Unauthorized when reading error body times out', async () => {
    vi.useFakeTimers();
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    fetchMock.mockResolvedValueOnce(neverSettlingResponse(401));

    const settled = captureError(feedsApi.list({ timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);

    expect(await settled).toMatchObject({ code: 'Unauthorized', status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('401 edge cases for no-content, login, and unsubscribe', () => {
  it('handles 401 on requestNoContent endpoints with empty body', async () => {
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(feedsApi.remove('f1')).rejects.toMatchObject({
      code: 'Unauthorized',
      status: 401,
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it.each([
    ['empty JSON body', () => jsonResponse({}, 401)],
    ['unreadable body', () => unreadableResponse(401)],
  ])(
    'keeps login 401 with %s as InvalidCredentials',
    async (_, makeResponse) => {
      const unauthorized = vi.fn();
      const unsubscribe = onUnauthorized(unauthorized);
      fetchMock.mockResolvedValueOnce(makeResponse());

      await expect(authApi.login('bad')).rejects.toMatchObject({
        code: 'InvalidCredentials',
        status: 401,
      });
      expect(unauthorized).not.toHaveBeenCalled();
      unsubscribe();
    }
  );

  it('stops notifying onUnauthorized after unsubscribe', async () => {
    const unauthorized = vi.fn();
    const unsubscribe = onUnauthorized(unauthorized);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(feedsApi.list()).rejects.toBeInstanceOf(ApiError);
    unsubscribe();

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(feedsApi.list()).rejects.toMatchObject({
      code: 'Unauthorized',
      status: 401,
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});
