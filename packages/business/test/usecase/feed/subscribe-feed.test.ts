import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref, Result } from 'effect';
import { FeedTitle } from '../../../src/entity/feed/feed';
import { FeedAlreadyExists } from '../../../src/usecase/feed/errors';
import { subscribeFeed } from '../../../src/usecase/feed/subscribe-feed';
import { alice, decodeUrl } from '../../support';
import { feedResponse, run, storedFeeds } from './support';

const url = decodeUrl('https://example.com/feed.xml');

const title = FeedTitle.make('My feed');

describe('subscribeFeed', () => {
  it.effect('creates a feed with the given title and no updated time', () =>
    Effect.gen(function* () {
      const fetched = yield* Ref.make(0);
      const result = yield* run(
        Effect.gen(function* () {
          const created = yield* subscribeFeed(alice, url, title);

          return { created, feeds: yield* storedFeeds(alice) };
        }),
        {
          fetchFeed: (target) =>
            Ref.update(fetched, (count) => count + 1).pipe(
              Effect.as(feedResponse({ url: target.href }))
            ),
        }
      );

      expect(result.created.url.href).toBe(url.href);
      expect(result.created.ownerId).toBe(alice);
      expect(result.created.title).toBe('My feed');
      expect(Option.isNone(result.created.updatedAt)).toBe(true);
      expect(result.feeds.map((feed) => feed.id)).toEqual([result.created.id]);
      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );
});

describe('subscribeFeed duplicates', () => {
  it.effect('fails a duplicate without creating a second feed', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          yield* subscribeFeed(alice, url, title);
          const error = yield* subscribeFeed(
            alice,
            url,
            FeedTitle.make('Another title')
          ).pipe(Effect.flip);

          return { error, feeds: yield* storedFeeds(alice) };
        })
      );

      expect(result.error).toStrictEqual(new FeedAlreadyExists({ url }));
      expect(result.feeds).toHaveLength(1);
    })
  );
});

describe('subscribeFeed races', () => {
  it.effect('creates exactly one feed for two concurrent subscriptions', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const results = yield* Effect.all(
            [
              subscribeFeed(alice, url, title),
              subscribeFeed(alice, url, title),
            ],
            { concurrency: 'unbounded', mode: 'result' }
          );

          return { results, feeds: yield* storedFeeds(alice) };
        })
      );
      const succeeded = result.results.filter(Result.isSuccess);

      expect(succeeded).toHaveLength(1);
      expect(result.feeds).toHaveLength(1);
    })
  );
});
