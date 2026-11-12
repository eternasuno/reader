import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref } from 'effect';
import { FeedParserError } from '../../../src/port/feed-parser';
import { FetchFeedError } from '../../../src/usecase/feed/errors';
import { refreshFeed } from '../../../src/usecase/feed/refresh-feed';
import { alice, bob, makeUniqueFeed } from '../../support';
import {
  feedResponse,
  findFeed,
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
  storeFeed,
  transportFailure,
  urlsOf,
} from './support';

const base = 'https://example.com';

const parsed = parsedFeed({
  title: 'Source title',
  entries: [parsedEntry(`${base}/a`)],
});

const recordFetch = (fetched: Ref.Ref<number>) => (url: URL) =>
  Ref.update(fetched, (count) => count + 1).pipe(
    Effect.as(feedResponse({ url: url.href }))
  );

describe('refreshFeed without a feed', () => {
  it.effect('succeeds without fetching when the feed does not exist', () =>
    Effect.gen(function* () {
      const missing = makeUniqueFeed({ ownerId: alice });
      const fetched = yield* Ref.make(0);

      yield* run(refreshFeed(alice, missing.id), {
        fetchFeed: recordFetch(fetched),
      });

      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );

  it.effect('succeeds without fetching for another owner’s feed', () =>
    Effect.gen(function* () {
      const foreign = makeUniqueFeed({ ownerId: bob });
      const fetched = yield* Ref.make(0);

      yield* run(
        Effect.gen(function* () {
          yield* storeFeed(foreign);
          yield* refreshFeed(alice, foreign.id);
        }),
        { fetchFeed: recordFetch(fetched) }
      );

      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );
});

describe('refreshFeed success', () => {
  it.effect('fetches the source, syncs its items and updates the feed', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const fetched: Array<string> = [];

      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);
          yield* refreshFeed(alice, feed.id);

          return {
            items: yield* storedItems(alice, feed.id),
            feed: yield* findFeed(alice, feed.id),
          };
        }),
        {
          fetchFeed: (url) => {
            fetched.push(url.href);

            return Effect.succeed(
              feedResponse({ url: `${base}/redirected.xml` })
            );
          },
          parseFeed: () => Effect.succeed(parsed),
        }
      );
      const stored = Option.getOrThrow(result.feed);

      expect(fetched).toEqual([feed.url.href]);
      expect(urlsOf(result.items)).toEqual([`${base}/a`]);
      expect(stored.title).toBe('Source title');
      expect(Option.isSome(stored.updatedAt)).toBe(true);
    })
  );
});

describe('refreshFeed fetch failure', () => {
  it.effect('propagates the error without updating the feed', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);

          return {
            error: yield* refreshFeed(alice, feed.id).pipe(Effect.flip),
            feed: yield* findFeed(alice, feed.id),
          };
        }),
        { fetchFeed: (url) => Effect.fail(transportFailure(url)) }
      );
      const stored = Option.getOrThrow(result.feed);

      expect(result.error).toStrictEqual(
        new FetchFeedError({ message: 'Failed to fetch the feed' })
      );
      expect(stored.title).toBe(feed.title);
      expect(Option.isNone(stored.updatedAt)).toBe(true);
    })
  );
});

describe('refreshFeed parse failure', () => {
  it.effect('propagates the error without updating the feed', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);

          const error = yield* refreshFeed(alice, feed.id).pipe(Effect.flip);

          return { error, feed: yield* findFeed(alice, feed.id) };
        }),
        {
          parseFeed: () =>
            Effect.fail(new FeedParserError({ message: 'parse' })),
        }
      );
      const stored = Option.getOrThrow(result.feed);

      expect(result.error).toStrictEqual(
        new FeedParserError({ message: 'parse' })
      );
      expect(stored.title).toBe(feed.title);
      expect(Option.isNone(stored.updatedAt)).toBe(true);
    })
  );
});
