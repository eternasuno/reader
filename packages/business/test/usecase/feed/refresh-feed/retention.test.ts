import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { FeedItem } from '../../../../src/entity/feed-item/feed-item';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { SettingRepository } from '../../../../src/port/setting-repository';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import {
  alice,
  decodeRetention,
  makeUniqueFeed,
} from '../../../support/fixtures';
import {
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
  storeItemsInListOrder,
  urlsOf,
} from '../support';

type Scenario = {
  /** The stored items in list order, newest first, before the sync. */
  readonly stored: ReadonlyArray<string>;
  /** The entries the source lists, in source order. */
  readonly listed: ReadonlyArray<string>;
  readonly retention: number;
  readonly readAll?: boolean;
};

const markAllRead = (feedId: FeedItem['feedId']) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const rows = yield* storedItems(alice, feedId);

    yield* items.markRead(
      alice,
      rows.map((row) => row.id),
      true
    );
  });

const syncScenario = (scenario: Scenario) =>
  run(
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const settings = yield* SettingRepository;
      const feed = makeUniqueFeed({ ownerId: alice });

      yield* feeds.create(alice, [feed]);
      yield* storeItemsInListOrder(feed, scenario.stored);

      if (scenario.readAll === true) {
        yield* markAllRead(feed.id);
      }

      yield* settings.setRetention(alice, decodeRetention(scenario.retention));
      yield* refreshFeed(alice, feed.id);

      return yield* storedItems(alice, feed.id);
    }),
    {
      parseFeed: () =>
        Effect.succeed(
          parsedFeed({
            entries: scenario.listed.map((url) => parsedEntry(url)),
          })
        ),
    }
  );

describe('refreshFeed retention', () => {
  it.effect('FD-SYNC step 4 removes the stored item that no longer fits', () =>
    Effect.gen(function* () {
      const rows = yield* syncScenario({
        stored: [
          'https://example.com/d',
          'https://example.com/c',
          'https://example.com/b',
        ],
        listed: [
          'https://example.com/n',
          'https://example.com/d',
          'https://example.com/c',
        ],
        retention: 3,
      });

      expect(urlsOf(rows)).toEqual([
        'https://example.com/n',
        'https://example.com/d',
        'https://example.com/c',
      ]);
    })
  );
});

describe('refreshFeed lowered retention', () => {
  it.effect(
    'FD-SEL-7 a lowered retention removes the oldest items at the next sync',
    () =>
      Effect.gen(function* () {
        const rows = yield* syncScenario({
          stored: [
            'https://example.com/e',
            'https://example.com/d',
            'https://example.com/c',
            'https://example.com/b',
          ],
          listed: ['https://example.com/e'],
          retention: 2,
        });

        expect(urlsOf(rows)).toEqual([
          'https://example.com/e',
          'https://example.com/d',
        ]);
      })
  );
});

describe('refreshFeed unlisted items', () => {
  it.effect(
    'FD-SEL-5 an item the source no longer lists stays while there is room',
    () =>
      Effect.gen(function* () {
        const rows = yield* syncScenario({
          stored: [
            'https://example.com/e',
            'https://example.com/d',
            'https://example.com/c',
          ],
          listed: ['https://example.com/e'],
          retention: 3,
        });

        expect(urlsOf(rows)).toEqual([
          'https://example.com/e',
          'https://example.com/d',
          'https://example.com/c',
        ]);
      })
  );
});

describe('refreshFeed read state and retention', () => {
  it.effect(
    'FD-SEL-4 read state plays no role, so a read item beyond N is removed',
    () =>
      Effect.gen(function* () {
        const rows = yield* syncScenario({
          stored: [
            'https://example.com/d',
            'https://example.com/c',
            'https://example.com/b',
          ],
          listed: [
            'https://example.com/n',
            'https://example.com/d',
            'https://example.com/c',
          ],
          retention: 3,
          readAll: true,
        });

        expect(urlsOf(rows)).toEqual([
          'https://example.com/n',
          'https://example.com/d',
          'https://example.com/c',
        ]);
      })
  );
});
