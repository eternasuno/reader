import { Effect, Exit, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import { makeFeedAtoms } from '../../src/lib/feeds';
import { LinksClientLive } from '../../src/lib/links';

const article = {
  key: 'a'.repeat(64),
  feedKey: 'feed',
  url: 'https://example.com/article',
  title: 'Article',
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: false,
};

const makeTest = () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (method === 'GET' && url.pathname === '/api/feeds') {
      return Response.json({ items: [] });
    }
    if (method === 'GET' && url.pathname === '/api/feeds/articles') {
      return Response.json({ items: [article], hasMore: false });
    }

    return Response.json({ ok: true });
  };
  const layer = LinksClientLive.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  const registry = AtomRegistry.make();
  const atoms = makeFeedAtoms(layer);
  registry.mount(atoms.feeds);
  registry.mount(atoms.articles);

  return { registry, atoms, requests };
};

describe('feed atoms', () => {
  it('marks articles without refetching feeds or the article page', async () => {
    const { registry, atoms, requests } = makeTest();
    try {
      await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.feeds, {
          suspendOnWaiting: true,
        })
      );
      await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.articles, {
          suspendOnWaiting: true,
        })
      );
      const loaded = requests.length;
      expect(loaded).toBe(2);
      registry.set(atoms.command, {
        _tag: 'Mark',
        key: article.key,
        read: true,
      });
      const exit = await Effect.runPromiseExit(
        AtomRegistry.getResult(registry, atoms.command, {
          suspendOnWaiting: true,
        })
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(
        requests.filter((request) => request.method === 'GET')
      ).toHaveLength(loaded);
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/feeds/articles',
        body: { key: article.key, read: true },
      });
    } finally {
      registry.dispose();
    }
  });
});
