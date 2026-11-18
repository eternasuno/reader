import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedItemQuery,
  feedRow,
  idsOf,
  itemRow,
  makeFeed,
  makeUniqueFeed,
  rowAt,
  storedFeed,
  storedFolder,
  updatedTime,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

export const preferenceCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-PREF-1 stores and lists the preferences of a feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const plain = makeUniqueFeed();
      const chosen = makeUniqueFeed({
        readerMode: 'embedded',
        order: 'oldest',
      });
      yield* feeds.create(alice, [plain, chosen]);

      const stored = yield* feeds.list(alice);

      expect(stored.find((feed) => feed.id === plain.id)).toMatchObject({
        readerMode: 'default',
        order: 'newest',
      });
      expect(stored.find((feed) => feed.id === chosen.id)).toMatchObject({
        readerMode: 'embedded',
        order: 'oldest',
      });
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-PREF-2 writes each preference without touching the rest', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = yield* storedFeed();

      yield* feeds.setReaderMode(alice, feed.id, 'extracted');
      yield* feeds.setOrder(alice, feed.id, 'oldest');

      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual({
        ...feed,
        readerMode: 'extracted',
        order: 'oldest',
      });
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-PREF-2 changes nothing for an unknown or foreign feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);
      yield* feeds.create(bob, [foreign]);

      yield* feeds.setReaderMode(alice, foreign.id, 'embedded');
      yield* feeds.setOrder(alice, foreign.id, 'oldest');
      yield* feeds.setOrder(alice, makeFeed().id, 'oldest');

      expect(Option.getOrThrow(yield* feeds.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const preferenceKeptCases =
  (makeLayer: FeedStoreFactory) => (): void => {
    it.effect('FD-PREF-5 sync and moving keep the preferences', () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const folder = yield* storedFolder();
        const feed = yield* storedFeed();
        yield* feeds.setReaderMode(alice, feed.id, 'embedded');
        yield* feeds.setOrder(alice, feed.id, 'oldest');

        yield* feeds.recordSync(
          alice,
          feed.id,
          FeedTitle.make('Renamed'),
          updatedTime()
        );
        yield* feeds.moveToFolder(alice, feed.id, Option.some(folder.id));

        expect(
          Option.getOrThrow(yield* feeds.find(alice, feed.id))
        ).toMatchObject({ readerMode: 'embedded', order: 'oldest' });
      }).pipe(Effect.provide(makeLayer()))
    );
  };

export const oldestListCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-PREF-3 lists a feed oldest first, the cursor meaning larger ids',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const rows = [itemRow(feed.id), itemRow(feed.id), itemRow(feed.id)];
        yield* items.create(alice, rows);
        const ascending = idsOf(rows).sort();

        const first = yield* items.listByFeed(
          alice,
          feed.id,
          feedItemQuery({ limit: 2 }),
          'oldest'
        );
        const next = yield* items.listByFeed(
          alice,
          feed.id,
          feedItemQuery({ cursor: Option.some(rowAt(first, 1).id) }),
          'oldest'
        );

        expect(idsOf(first)).toEqual(ascending.slice(0, 2));
        expect(idsOf(next)).toEqual(ascending.slice(2));
      }).pipe(Effect.provide(makeLayer()))
  );
};
