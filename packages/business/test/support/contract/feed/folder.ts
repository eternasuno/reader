import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueFolder,
  storedFolder,
  updatedTime,
} from '../../fixtures';
import type { FeedStoreLayer } from '.';

const createFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('stores a feed in the folder of the owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({
        ownerId: alice,
        folderId: Option.some(folder.id),
      });

      expect(yield* feeds.create(alice, [feed])).toEqual([feed.id]);
      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
        feed
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('skips a feed whose folder is unknown or of another owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const bobFolder = yield* storedFolder(bob);
      const plain = makeUniqueFeed({ ownerId: alice });
      const unknown = makeUniqueFeed({
        ownerId: alice,
        folderId: Option.some(makeUniqueFolder().id),
      });
      const foreign = makeUniqueFeed({
        ownerId: alice,
        folderId: Option.some(bobFolder.id),
      });
      const created = yield* feeds.create(alice, [plain, unknown, foreign]);

      expect(created).toEqual([plain.id]);
      expect(yield* feeds.list(alice)).toEqual([plain]);
      expect(yield* feeds.list(bob)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const moveFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('sets the folder of the feed and returns true', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed();
      yield* feeds.create(alice, [feed]);

      const moved = yield* feeds.moveToFolder(
        alice,
        feed.id,
        Option.some(folder.id)
      );

      expect(moved).toBe(true);
      expect(
        Option.getOrThrow(
          Option.getOrThrow(yield* feeds.find(alice, feed.id)).folderId
        )
      ).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );

  it.effect('clears the folder with none and returns true', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      const cleared = yield* feeds.moveToFolder(alice, feed.id, Option.none());

      expect(cleared).toBe(true);
      expect(
        Option.isNone(
          Option.getOrThrow(yield* feeds.find(alice, feed.id)).folderId
        )
      ).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const moveKeepsFeedCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'FD-MOVE-2 moveToFolder keeps the title, updatedAt and items of the feed',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const feed = makeUniqueFeed({
          title: FeedTitle.make('Kept'),
          updatedAt: Option.some(updatedTime()),
        });
        const item = makeUniqueFeedItem({ feedId: feed.id });
        yield* feeds.create(alice, [feed]);
        yield* items.create(alice, [item]);

        yield* feeds.moveToFolder(alice, feed.id, Option.some(folder.id));

        const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

        expect(stored.title).toBe(feed.title);
        expect(stored.updatedAt).toStrictEqual(feed.updatedAt);
        expect(
          yield* items.listByFeed(alice, feed.id, {
            limit: 10,
            unreadOnly: false,
          })
        ).toEqual([item]);
      }).pipe(Effect.provide(layer))
  );
};

const folderRefuseCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-FOLDER-6 writes nothing for an unknown or foreign folder', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const bobFolder = yield* storedFolder(bob);
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      const unknown = yield* feeds.moveToFolder(
        alice,
        feed.id,
        Option.some(makeUniqueFolder().id)
      );
      const foreign = yield* feeds.moveToFolder(
        alice,
        feed.id,
        Option.some(bobFolder.id)
      );
      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(unknown).toBe(false);
      expect(foreign).toBe(false);
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );
};

const refusedFeedCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns false for an unknown or foreign feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const bobFeed = makeUniqueFeed({ ownerId: bob });
      yield* feeds.create(bob, [bobFeed]);

      const foreign = yield* feeds.moveToFolder(
        alice,
        bobFeed.id,
        Option.none()
      );
      const unknown = yield* feeds.moveToFolder(
        alice,
        makeUniqueFeed().id,
        Option.none()
      );

      expect(foreign).toBe(false);
      expect(unknown).toBe(false);
      expect(Option.getOrThrow(yield* feeds.find(bob, bobFeed.id))).toEqual(
        bobFeed
      );
    }).pipe(Effect.provide(layer))
  );
};

const syncFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-FOLDER-9 recordSync keeps the folder', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      yield* feeds.recordSync(
        alice,
        feed.id,
        FeedTitle.make('Renamed'),
        updatedTime()
      );
      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(stored.title).toBe('Renamed');
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );
};

export const folderCases = (layer: FeedStoreLayer) => (): void => {
  describe('create', createFolderCases(layer));
  describe('move', () => {
    describe('folder', moveFolderCases(layer));
    describe('keeps the feed', moveKeepsFeedCases(layer));
  });
  describe('sync', syncFolderCases(layer));
  describe('refused folder', folderRefuseCases(layer));
  describe('refused feed', refusedFeedCases(layer));
};
