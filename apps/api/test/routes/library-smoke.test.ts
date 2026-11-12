import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { makeHarness } from './library-support';

type SavedPageBody = {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly read: boolean;
  }>;
  readonly cursor: string | null;
};

type FeedBody = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt?: string;
};

const json = <A>(response: Response) => response.json() as Promise<A>;

it.effect('rejects library requests without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const response = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/saved-pages',
          query: { limit: 30 },
        })
      );

      expect(response.status).toBe(401);
    })
  )
);

it.effect('adds a saved page from the stubbed webpage and lists it', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* Effect.promise(() =>
        harness.signIn('alice@example.com')
      );
      const created = yield* Effect.promise(() =>
        harness.call({
          method: 'POST',
          path: '/api/library/saved-pages',
          cookie: session.cookie,
          body: { url: ' https://example.com/article?utm_source=news ' },
        })
      );

      expect(created.status).toBe(201);
      const body = yield* Effect.promise(() =>
        json<{ item: { id: string; url: string; read: boolean } }>(created)
      );
      expect(body.item.url).toBe('https://example.com/article');
      expect(body.item.read).toBe(false);

      const listed = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/saved-pages',
          query: { limit: 30 },
          cookie: session.cookie,
        })
      );
      const page = yield* Effect.promise(() => json<SavedPageBody>(listed));

      expect(listed.status).toBe(200);
      expect(page.items.map((item) => item.id)).toEqual([body.item.id]);
      expect(page.cursor).toBeNull();
    })
  )
);

it.effect('subscribes to a feed and queues its first refresh', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* Effect.promise(() =>
        harness.signIn('bob@example.com')
      );
      const created = yield* Effect.promise(() =>
        harness.call({
          method: 'POST',
          path: '/api/library/feeds',
          cookie: session.cookie,
          body: {
            url: ' https://example.com/feed.xml?utm_source=news ',
            title: 'My feed',
          },
        })
      );
      const body = yield* Effect.promise(() =>
        json<{ item: FeedBody }>(created)
      );

      expect(created.status).toBe(201);
      expect(body.item.url).toBe('https://example.com/feed.xml');
      expect(body.item.title).toBe('My feed');
      expect(Object.hasOwn(body.item, 'updatedAt')).toBe(false);
      expect(harness.enqueued).toHaveLength(1);
      expect(harness.enqueued[0]?.owner).toBe(session.owner);
      expect(harness.enqueued[0]?.feedId).toBe(body.item.id);

      const items = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/feeds/items',
          query: { limit: 30 },
          cookie: session.cookie,
        })
      );
      const page = yield* Effect.promise(() => json<SavedPageBody>(items));

      expect(items.status).toBe(200);
      expect(page.items).toEqual([]);
      expect(page.cursor).toBeNull();
    })
  )
);

it.effect('returns only the configured flags for settings', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* Effect.promise(() =>
        harness.signIn('carol@example.com')
      );
      const response = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/settings',
          cookie: session.cookie,
        })
      );
      const body = yield* Effect.promise(() => json<object>(response));

      expect(response.status).toBe(200);
      expect(body).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKeyConfigured: false,
        browserEndpointConfigured: false,
      });
    })
  )
);
