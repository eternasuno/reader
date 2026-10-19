import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  FeedFetcher,
  FeedRepository,
  listFeedArticles,
  refreshFeed,
  subscribeFeed,
} from '../../src';

it.effect(
  'imports a new subscription with initial retention policy and owner identity',
  () => {
    const feed = {
      key: 'feed',
      url: 'https://example.com/rss',
      title: 'Example',
      updatedAt: '',
      error: '',
    };

    return Effect.gen(function* () {
      expect((yield* subscribeFeed('alice', feed.url)).item.key).toBe('feed');
      expect(yield* listFeedArticles('alice', '', false, 30)).toEqual({
        items: [],
        hasMore: false,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(FeedFetcher, {
            fetch: () => Effect.succeed({ title: 'Example', articles: [] }),
          }),
          Layer.mock(FeedRepository, {
            create: (owner) => {
              expect(owner).toBe('alice');
              return Effect.succeed(feed);
            },
            sync: (owner, key, _parsed, initial) => {
              expect([owner, key, initial]).toEqual(['alice', 'feed', true]);
              return Effect.void;
            },
            articles: (owner, key, read, offset, limit) => {
              expect([owner, key, read, offset, limit]).toEqual([
                'alice',
                '',
                false,
                30,
                31,
              ]);
              return Effect.succeed([]);
            },
          })
        )
      )
    );
  }
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
