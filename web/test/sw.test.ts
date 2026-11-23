import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('public/sw.js', 'utf8')
  .replace('__LEAF_SW_CACHE__', 'leaf-new')
  .replace('/* __LEAF_PRECACHE_URLS__ */ []', "['/', '/assets/app.js']");

it('leaves an installed update waiting and cleans old caches on activation', async () => {
  const listeners = new Map<
    string,
    (event: { waitUntil: (promise: Promise<unknown>) => void }) => void
  >();
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const remove = vi.fn();
  const put = vi.fn();
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, listener: never) =>
        listeners.set(name, listener),
      skipWaiting,
      clients: { claim },
    },
    caches: {
      open: async () => ({ put }),
      keys: async () => ['leaf-old', 'leaf-new', 'other'],
      delete: remove,
    },
    fetch: async () => ({ ok: true, type: 'basic', redirected: false }),
  });
  let pending: Promise<unknown> = Promise.resolve();
  const event = {
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  };
  listeners.get('install')?.(event);
  await pending;
  expect(put).toHaveBeenCalledTimes(2);
  expect(skipWaiting).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();
  listeners.get('activate')?.(event);
  await pending;
  expect(remove).toHaveBeenCalledExactlyOnceWith('leaf-old');
  expect(claim).toHaveBeenCalledOnce();
});

it('rejects a failed install and deletes its partial cache', async () => {
  const listeners = new Map<
    string,
    (event: { waitUntil: (promise: Promise<unknown>) => void }) => void
  >();
  const remove = vi.fn();
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, listener: never) =>
        listeners.set(name, listener),
    },
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
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get('install')?.({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await expect(pending).rejects.toThrow('write failed');
  expect(remove).toHaveBeenCalledExactlyOnceWith('leaf-new');
});
