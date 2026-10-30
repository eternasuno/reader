import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  FeedFetchError,
  FeedFetcher,
  type FeedImport,
  FeedRepository,
  listFeedArticles,
  markAllFeedArticles,
  markLoadedFeedArticles,
  refreshFeed,
  refreshSubscriptions,
} from '../../src';

const exampleFeed = {
  key: 'feed',
  url: 'https://example.com/rss',
  title: 'Example',
  updatedAt: '',
  error: '',
  unreadCount: 0,
};

it.effect('lists and pages feed articles with owner-scoped cursors', () =>
  Effect.gen(function* () {
    expect(yield* listFeedArticles('alice', '', false, 30)).toEqual({
      items: [],
      hasMore: false,
    });
  }).pipe(
    Effect.provide(
      Layer.mock(FeedRepository, {
        articles: (owner, key, read, offset, limit, all, before, beforeKey) => {
          expect([
            owner,
            key,
            read,
            offset,
            limit,
            all,
            before,
            beforeKey,
          ]).toEqual(['alice', '', false, 30, 31, false, '', '']);

          return Effect.succeed([]);
        },
      })
    )
  )
);

it.effect('does not fetch another account subscription', () =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(refreshFeed('bob', 'private')))._tag).toBe(
      'FeedNotFound'
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedRepository, { find: () => Effect.succeed(undefined) }),
        Layer.mock(FeedFetcher, {})
      )
    )
  )
);

it.effect(
  'marks only the loaded feed article keys through one owner-scoped update',
  () => {
    const calls: (readonly [string, readonly string[]])[] = [];

    return Effect.gen(function* () {
      const keys = ['a'.repeat(64)];
      expect(yield* markLoadedFeedArticles('alice', keys)).toEqual({
        ok: true,
      });
      expect(yield* markLoadedFeedArticles('alice', [])).toEqual({ ok: true });
      expect(calls).toEqual([
        ['alice', keys],
        ['alice', []],
      ]);
    }).pipe(
      Effect.provide(
        Layer.mock(FeedRepository, {
          markLoaded: (owner, keys) => {
            calls.push([owner, keys]);

            return Effect.void;
          },
        })
      )
    );
  }
);

it.effect(
  'keeps the scheduler refreshing every subscription despite failures',
  () => {
    const fetched: string[] = [];
    const synced: string[] = [];
    const failed: string[] = [];
    const layer = Layer.mergeAll(
      Layer.mock(FeedRepository, {
        subscriptions: Effect.succeed([
          { owner: 'alice', key: 'first' },
          { owner: 'bob', key: 'second' },
        ]),
        find: (_owner, key) =>
          Effect.succeed({
            ...exampleFeed,
            key,
            url: `https://example.com/${key}`,
          }),
        sync: (owner, key, imported) => {
          expect(imported).toEqual({
            title: 'Example',
            articles: [],
            retention: 500,
          });
          synced.push(`${owner}:${key}`);

          return Effect.void;
        },
        failure: (owner, key, message) => {
          failed.push(`${owner}:${key}:${message}`);

          return Effect.void;
        },
      }),
      Layer.succeed(FeedFetcher, {
        fetch: (url) => {
          fetched.push(url);

          return url.endsWith('second')
            ? Effect.fail(new FeedFetchError({ error: 'down' }))
            : Effect.succeed({ title: 'Example', articles: [] });
        },
      })
    );

    return Effect.gen(function* () {
      yield* refreshSubscriptions;
      expect(fetched.toSorted()).toEqual([
        'https://example.com/first',
        'https://example.com/second',
      ]);
      expect(synced).toEqual(['alice:first']);
      expect(failed).toEqual(['bob:second:down']);
    }).pipe(Effect.provide(layer));
  }
);

it.effect('forwards cursor pagination and bulk feed article marks', () =>
  Effect.gen(function* () {
    expect(
      yield* listFeedArticles('alice', 'feed', false, 0, true, 'cursor', 'key')
    ).toEqual({ items: [], hasMore: false });
    expect(yield* markAllFeedArticles('alice', 'feed')).toEqual({ ok: true });
  }).pipe(
    Effect.provide(
      Layer.mock(FeedRepository, {
        articles: (
          owner,
          feedKey,
          read,
          offset,
          limit,
          all,
          before,
          beforeKey
        ) => {
          expect([
            owner,
            feedKey,
            read,
            offset,
            limit,
            all,
            before,
            beforeKey,
          ]).toEqual(['alice', 'feed', false, 0, 31, true, 'cursor', 'key']);

          return Effect.succeed([]);
        },
        markAll: (owner, feedKey) => {
          expect([owner, feedKey]).toEqual(['alice', 'feed']);

          return Effect.void;
        },
      })
    )
  )
);

it.effect(
  'refreshes with the newest 500 articles and the explicit retention cap',
  () => {
    const synced: FeedImport[] = [];
    const articles = Array.from({ length: 600 }, (_, index) => ({
      identity: String(index),
      url: `https://example.com/${index}`,
      title: String(index),
      publishedAt: new Date(index * 1000).toISOString(),
    }));

    return Effect.gen(function* () {
      yield* refreshFeed('alice', 'feed');
      expect(synced).toHaveLength(1);
      const imported = synced[0];
      expect(imported?.retention).toBe(500);
      expect(imported?.articles).toHaveLength(500);
      expect(imported?.articles[0]?.title).toBe('599');
      expect(imported?.articles[499]?.title).toBe('100');
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(FeedRepository, {
            find: () => Effect.succeed(exampleFeed),
            sync: (_owner, _key, imported) => {
              synced.push(imported);

              return Effect.void;
            },
          }),
          Layer.succeed(FeedFetcher, {
            fetch: () => Effect.succeed({ title: 'Example', articles }),
          })
        )
      )
    );
  }
);
