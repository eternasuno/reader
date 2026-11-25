// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

type WaitUntilEvent = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type FetchEvent = {
  request: { url: string; method: string; mode: string; cache: string };
  respondWith: (promise: Promise<unknown>) => void;
};

type SwListener = (event: WaitUntilEvent & FetchEvent) => void;

const source = readFileSync('public/sw.js', 'utf8')
  .replace('__LANTERN_SW_CACHE__', 'lantern-new')
  .replace('/* __LANTERN_PRECACHE_URLS__ */ []', "['/', '/assets/app.js']");

const loadSw = (overrides: {
  self?: Record<string, unknown>;
  caches?: Record<string, unknown>;
  fetch?: unknown;
}) => {
  const listeners = new Map<string, SwListener>();
  runInNewContext(source, {
    URL,
    ...overrides,
    self: {
      addEventListener: (name: string, listener: SwListener) =>
        listeners.set(name, listener),
      ...overrides.self,
    },
  });

  return {
    dispatchLifecycle: (name: 'install' | 'activate'): Promise<unknown> => {
      let pending: Promise<unknown> = Promise.resolve();
      listeners.get(name)?.({
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise;
        },
      } as WaitUntilEvent & FetchEvent);

      return pending;
    },
    dispatchFetch: (request: FetchEvent['request']) => {
      let response: Promise<unknown> | undefined;
      listeners.get('fetch')?.({
        request,
        respondWith: (promise: Promise<unknown>) => {
          response = promise;
        },
      } as WaitUntilEvent & FetchEvent);

      return response;
    },
  };
};

it('leaves an installed update waiting and cleans old caches on activation', async () => {
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const remove = vi.fn();
  const put = vi.fn();
  const sw = loadSw({
    self: { skipWaiting, clients: { claim } },
    caches: {
      open: async () => ({ put }),
      keys: async () => ['lantern-old', 'lantern-new', 'other'],
      delete: remove,
    },
    fetch: async () => ({ ok: true, type: 'basic', redirected: false }),
  });

  await sw.dispatchLifecycle('install');
  expect(put).toHaveBeenCalledTimes(2);
  expect(skipWaiting).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();

  await sw.dispatchLifecycle('activate');
  expect(remove).toHaveBeenCalledExactlyOnceWith('lantern-old');
  expect(claim).toHaveBeenCalledOnce();
});

it('rejects a failed install and deletes its partial cache', async () => {
  const remove = vi.fn();
  const sw = loadSw({
    caches: {
      open: async () => ({
        put: async () => {
          throw new Error('write failed');
        },
      }),
      delete: remove,
    },
    fetch: async () => ({ ok: true, type: 'basic', redirected: false }),
  });

  await expect(sw.dispatchLifecycle('install')).rejects.toThrow('write failed');
  expect(remove).toHaveBeenCalledExactlyOnceWith('lantern-new');
});

it('returns the fetched asset when runtime cache.put rejects', async () => {
  const assetResponse = {
    ok: true,
    type: 'basic',
    redirected: false,
    clone: () => assetResponse,
  };
  const put = vi.fn(async () => {
    throw new Error('QuotaExceededError');
  });
  const fetchMock = vi.fn(async () => assetResponse);
  const sw = loadSw({
    self: { location: { origin: 'https://example.com' } },
    caches: {
      open: async () => ({ match: async () => undefined, put }),
    },
    fetch: fetchMock,
  });

  const responsePromise = sw.dispatchFetch({
    url: 'https://example.com/assets/app.js',
    method: 'GET',
    mode: 'no-cors',
    cache: 'default',
  });

  expect(responsePromise).toBeDefined();
  await expect(responsePromise).resolves.toBe(assetResponse);
  expect(fetchMock).toHaveBeenCalledWith(expect.anything(), {
    credentials: 'omit',
    redirect: 'error',
  });
  expect(put).toHaveBeenCalledOnce();
});
