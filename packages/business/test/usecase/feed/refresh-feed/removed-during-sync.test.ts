import { describe, expect, it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Option } from 'effect';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import { alice, makeUniqueFeed } from '../../../support/fixtures';
import {
  decoratedStore,
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
} from '../support';

/**
 * FD-SYNC-5: the feed is removed while the sync runs, between the inventory
 * read and the writes, so `create`, `remove` and `recordSync` all work on a
 * feed that is gone.
 */
describe('refreshFeed when the feed is removed during the sync', () => {
  it.effect('FD-SYNC-5 leaves no items behind and still succeeds', () =>
    Effect.gen(function* () {
      const reachedInventory = yield* Deferred.make<void>();
      const feedRemoved = yield* Deferred.make<void>();
      const store = decoratedStore((items) => ({
        ...items,
        inventory: (owner, feedId) =>
          Effect.andThen(
            Deferred.succeed(reachedInventory, void 0),
            Effect.andThen(
              Deferred.await(feedRemoved),
              items.inventory(owner, feedId)
            )
          ),
      }));

      const outcome = yield* run(
        Effect.gen(function* () {
          const feeds = yield* FeedRepository;
          const feed = makeUniqueFeed({ ownerId: alice });

          yield* feeds.create(alice, [feed]);

          const remover = yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Deferred.await(reachedInventory);
              yield* feeds.remove(alice, [feed.id]);
              yield* Deferred.succeed(feedRemoved, void 0);
            })
          );

          yield* refreshFeed(alice, feed.id);
          yield* Fiber.join(remover);

          return {
            found: yield* feeds.find(alice, feed.id),
            items: yield* storedItems(alice, feed.id),
          };
        }),
        {
          parseFeed: () =>
            Effect.succeed(
              parsedFeed({ entries: [parsedEntry('https://example.com/a')] })
            ),
        },
        store
      );

      expect(Option.isNone(outcome.found)).toBe(true);
      expect(outcome.items).toEqual([]);
    })
  );
});
