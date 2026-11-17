import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import type { Feed } from '../../../../src/entity/feed/feed';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedParserError } from '../../../../src/error/feed';
import { FeedItemRepositoryError } from '../../../../src/error/feed-item';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { SettingRepository } from '../../../../src/port/setting-repository';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import {
  alice,
  bob,
  decodeRetention,
  decodeTitle,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
  updatedTime,
} from '../../../support/fixtures';
import {
  decoratedStore,
  feedResponse,
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
  storeItemsInListOrder,
  transportFailure,
  urlsOf,
} from '../support';

const rowsOf = (feedId: Feed['id']) => storedItems(alice, feedId);

describe('refreshFeed', () => {
  it.effect(
    'FD-REFRESH-1 a feed that does not exist does nothing and fetches nothing',
    () =>
      Effect.gen(function* () {
        const targets: Array<string> = [];

        yield* run(refreshFeed(alice, makeUniqueFeed().id), {
          fetchFeed: (target) => {
            targets.push(target.href);

            return Effect.succeed(feedResponse({ url: target.href }));
          },
        });

        expect(targets).toEqual([]);
      })
  );

  it.effect('FD-REFRESH-1 a feed of another owner is not refreshed', () =>
    Effect.gen(function* () {
      const targets: Array<string> = [];

      yield* run(
        Effect.gen(function* () {
          const feeds = yield* FeedRepository;
          const feed = makeUniqueFeed({ ownerId: bob });

          yield* feeds.create(bob, [feed]);
          yield* refreshFeed(alice, feed.id);
        }),
        {
          fetchFeed: (target) => {
            targets.push(target.href);

            return Effect.succeed(feedResponse({ url: target.href }));
          },
        }
      );

      expect(targets).toEqual([]);
    })
  );
});

describe('refreshFeed sync record', () => {
  it.effect('FD-SYNC step 5 records the source title and the sync time', () =>
    Effect.gen(function* () {
      const syncTime = updatedTime();
      const feed = yield* run(
        Effect.gen(function* () {
          const feeds = yield* FeedRepository;
          const row = makeUniqueFeed({
            ownerId: alice,
            title: FeedTitle.make('Preview title'),
          });

          yield* feeds.create(alice, [row]);
          yield* TestClock.setTime(syncTime.epochMilliseconds);
          yield* refreshFeed(alice, row.id);

          return yield* feeds.find(alice, row.id);
        }),
        {
          parseFeed: () =>
            Effect.succeed(parsedFeed({ title: 'Source title' })),
        }
      );

      expect(Option.getOrThrow(feed).title).toBe('Source title');
      expect(
        Option.getOrThrow(Option.getOrThrow(feed).updatedAt).epochMilliseconds
      ).toBe(syncTime.epochMilliseconds);
    })
  );
});

const expectUnchangedPreview = (found: Option.Option<Feed>): void => {
  const stored = Option.getOrThrow(found);

  expect(stored.title).toBe('Preview title');
  expect(Option.isNone(stored.updatedAt)).toBe(true);
};

describe('refreshFeed fetch failures', () => {
  it.effect(
    'FD-SYNC-4 a failed fetch leaves the title and the sync time as they were',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;
            const row = makeUniqueFeed({
              ownerId: alice,
              title: FeedTitle.make('Preview title'),
            });

            yield* feeds.create(alice, [row]);
            const error = yield* refreshFeed(alice, row.id).pipe(Effect.flip);

            return { error, found: yield* feeds.find(alice, row.id) };
          }),
          {
            fetchFeed: (target) => Effect.fail(transportFailure(target)),
          }
        );

        expect(outcome.error._tag).toBe('FetchFeedError');
        expectUnchangedPreview(outcome.found);
      })
  );
});

describe('refreshFeed item create failures', () => {
  it.effect(
    'FD-SYNC-4 a failed item create propagates and skips recordSync',
    () =>
      Effect.gen(function* () {
        const store = decoratedStore((items) => ({
          ...items,
          create: () =>
            Effect.fail(new FeedItemRepositoryError({ message: 'create' })),
        }));
        const outcome = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;
            const row = makeUniqueFeed({
              ownerId: alice,
              title: FeedTitle.make('Preview title'),
            });

            yield* feeds.create(alice, [row]);
            const error = yield* refreshFeed(alice, row.id).pipe(Effect.flip);

            return { error, found: yield* feeds.find(alice, row.id) };
          }),
          {
            parseFeed: () =>
              Effect.succeed(
                parsedFeed({
                  title: 'Source title',
                  entries: [parsedEntry('https://example.com/new')],
                })
              ),
          },
          store
        );

        expect(outcome.error._tag).toBe('FeedItemRepositoryError');
        expectUnchangedPreview(outcome.found);
      })
  );
});

describe('refreshFeed item remove failures', () => {
  it.effect(
    'FD-SYNC-4 a failed item remove propagates and skips recordSync',
    () =>
      Effect.gen(function* () {
        const store = decoratedStore((items) => ({
          ...items,
          remove: () =>
            Effect.fail(new FeedItemRepositoryError({ message: 'remove' })),
        }));
        const outcome = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;
            const settings = yield* SettingRepository;
            const row = makeUniqueFeed({
              ownerId: alice,
              title: FeedTitle.make('Preview title'),
            });

            yield* feeds.create(alice, [row]);
            yield* storeItemsInListOrder(row, ['https://example.com/old']);
            yield* settings.setRetention(alice, decodeRetention(1));
            const error = yield* refreshFeed(alice, row.id).pipe(Effect.flip);

            return { error, found: yield* feeds.find(alice, row.id) };
          }),
          {
            parseFeed: () =>
              Effect.succeed(
                parsedFeed({
                  title: 'Source title',
                  entries: [parsedEntry('https://example.com/new')],
                })
              ),
          },
          store
        );

        expect(outcome.error._tag).toBe('FeedItemRepositoryError');
        expectUnchangedPreview(outcome.found);
      })
  );
});

describe('refreshFeed stored items', () => {
  it.effect(
    'FD-SYNC-1 a stored item keeps its first-imported values and read state',
    () =>
      Effect.gen(function* () {
        const rows = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;
            const items = yield* FeedItemRepository;
            const feed = makeUniqueFeed({ ownerId: alice });

            yield* feeds.create(alice, [feed]);
            yield* items.create(alice, [
              makeFeedItem({
                ownerId: alice,
                feedId: feed.id,
                url: decodeUrl('https://example.com/a'),
                title: decodeTitle('Old title'),
                read: true,
              }),
            ]);
            yield* refreshFeed(alice, feed.id);

            return yield* rowsOf(feed.id);
          }),
          {
            parseFeed: () =>
              Effect.succeed(
                parsedFeed({
                  entries: [
                    parsedEntry('https://example.com/a', {
                      title: 'New title',
                    }),
                  ],
                })
              ),
          }
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.title).toBe('Old title');
        expect(rows[0]?.read).toBe(true);
      })
  );
});

describe('refreshFeed and other feeds', () => {
  it.effect('FD-SYNC-3 syncing one feed leaves the other feeds alone', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const feeds = yield* FeedRepository;
          const other = makeUniqueFeed({ ownerId: alice });
          const feed = makeUniqueFeed({ ownerId: alice });

          yield* feeds.create(alice, [other, feed]);
          yield* storeItemsInListOrder(other, ['https://example.com/other']);
          yield* refreshFeed(alice, feed.id);

          return {
            untouched: yield* rowsOf(other.id),
            refreshed: yield* rowsOf(feed.id),
          };
        }),
        {
          parseFeed: () =>
            Effect.succeed(
              parsedFeed({ entries: [parsedEntry('https://example.com/a')] })
            ),
        }
      );

      expect(urlsOf(outcome.untouched)).toEqual(['https://example.com/other']);
      expect(urlsOf(outcome.refreshed)).toEqual(['https://example.com/a']);
    })
  );
});

describe('refreshFeed parse failures', () => {
  it.effect(
    'FD-REFRESH-2 a source that cannot be parsed fails FeedParserError',
    () =>
      Effect.gen(function* () {
        const error = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;
            const feed = makeUniqueFeed({ ownerId: alice });

            yield* feeds.create(alice, [feed]);

            return yield* refreshFeed(alice, feed.id);
          }),
          {
            parseFeed: () =>
              Effect.fail(new FeedParserError({ message: 'no feed' })),
          }
        ).pipe(Effect.flip);

        expect(error._tag).toBe('FeedParserError');
      })
  );
});
