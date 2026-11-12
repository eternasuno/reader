import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { callJson, putFetcher, signIn } from './library-settings-support';
import { type Harness, makeHarness } from './library-support';

// The harness transport exposes only the fetched URL with the Jina prefix
// removed, so the `Authorization` header that carries the key is not visible.
const recordWebpageCalls = (harness: Harness) => {
  const { stubs } = harness;
  const calls: Array<string> = [];
  const page = stubs.webpage;

  stubs.webpage = (url) => {
    calls.push(url);

    return page(url);
  };

  return calls;
};

const addArticle = (harness: Harness, cookie: string) =>
  callJson<{ item: { id: string; url: string } } | { _tag: string }>(harness, {
    method: 'POST',
    path: '/api/library/saved-pages',
    cookie,
    body: { url: 'https://example.com/article' },
  });

it.effect('adds a saved page through the stored Jina fetcher', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'jina-secret-key',
      });
      const calls = recordWebpageCalls(harness);
      const result = yield* addArticle(harness, session.cookie);

      expect(result.status).toBe(201);
      expect(calls).toEqual(['https://example.com/article']);
    })
  )
);

it.effect('uses the browser fetcher instead of the Jina transport', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
        endpoint: 'ws://127.0.0.1:1',
      });
      const calls = recordWebpageCalls(harness);
      const result = yield* addArticle(harness, session.cookie);

      expect(result.status).toBe(422);
      expect(result.body).toEqual({
        _tag: 'WebpageFetcherError',
        message: '网页抓取失败，请稍后重试',
      });
      expect(calls).toEqual([]);
    })
  )
);
