import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../../src/entity/common/article';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedItemQuery,
  itemRow,
  makeUniqueFeed,
  makeUniqueFolder,
  storedFolder,
  updatedTime,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const createInFolderCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-SUB-6 stores a feed in the folder of the owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });

      expect(yield* feeds.create(alice, [feed])).toEqual([feed.id]);
      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
        feed
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-FOLDER-6 skips a feed whose folder is unknown or foreign', () =>
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

      expect(yield* feeds.create(alice, [unknown, plain, foreign])).toEqual([
        plain.id,
      ]);
      expect(yield* feeds.list(alice)).toEqual([plain]);
      expect(yield* feeds.list(bob)).toEqual([]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const setsFolderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-PORT-5 moveToFolder sets the folder and returns true', () =>
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
      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(moved).toBe(true);
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const clearsFolderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'CM-PORT-5 moveToFolder takes the feed out with none and returns true',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const folder = yield* storedFolder();
        const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
        yield* feeds.create(alice, [feed]);

        const moved = yield* feeds.moveToFolder(alice, feed.id, Option.none());
        const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

        expect(moved).toBe(true);
        expect(Option.isNone(stored.folderId)).toBe(true);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const sameFolderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-MOVE-1 moving to the current folder succeeds and changes nothing',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const folder = yield* storedFolder();
        const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
        yield* feeds.create(alice, [feed]);

        const moved = yield* feeds.moveToFolder(
          alice,
          feed.id,
          Option.some(folder.id)
        );

        expect(moved).toBe(true);
        expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
          feed
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const keepsFeedCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-MOVE-2 keeps the title, the sync time and the items', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({
        title: FeedTitle.make('Kept'),
        updatedAt: Option.some(updatedTime()),
      });
      const content = ArticleContent.make('<p>Extracted</p>');
      const item = itemRow(feed.id, { read: true });
      yield* feeds.create(alice, [feed]);
      yield* items.create(alice, [item]);
      yield* items.setExtractedContent(alice, item.id, content);

      yield* feeds.moveToFolder(alice, feed.id, Option.some(folder.id));

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));
      const storedItem = Option.getOrThrow(yield* items.find(alice, item.id));

      expect(stored.title).toBe(feed.title);
      expect(stored.updatedAt).toStrictEqual(feed.updatedAt);
      expect(storedItem.read).toBe(true);
      expect(Option.getOrThrow(storedItem.extractedContent)).toBe(content);
      expect(yield* items.listByFeed(alice, feed.id, feedItemQuery())).toEqual([
        storedItem,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const refusedFeedCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-PORT-5 returns false for an unknown or foreign feed', () =>
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
    }).pipe(Effect.provide(makeLayer()))
  );
};

const refusedFolderCase = (makeLayer: FeedStoreFactory): void => {
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
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const folderCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('create', createInFolderCases(makeLayer));
  describe('move', () => {
    setsFolderCase(makeLayer);
    clearsFolderCase(makeLayer);
    sameFolderCase(makeLayer);
  });
  describe('keeps the feed', keepsFeedCases(makeLayer));
  describe('refused write', () => {
    refusedFeedCase(makeLayer);
    refusedFolderCase(makeLayer);
  });
};
