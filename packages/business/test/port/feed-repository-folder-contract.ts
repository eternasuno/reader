import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../src/entity/feed/feed';
import { FeedRepository } from '../../src/port/feed-repository';
import {
  alice,
  bob,
  makeUniqueFeed,
  makeUniqueFolder,
  storedFolder,
} from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';

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

const updateFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('sets the folder of the feed and returns its id', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed();
      yield* feeds.create(alice, [feed]);

      const moved = yield* feeds.update(alice, [feed.id], {
        folderId: Option.some(folder.id),
      });

      expect(moved).toEqual([feed.id]);
      expect(
        Option.getOrThrow(
          Option.getOrThrow(yield* feeds.find(alice, feed.id)).folderId
        )
      ).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );

  it.effect('clears the folder with none', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      const cleared = yield* feeds.update(alice, [feed.id], {
        folderId: Option.none(),
      });

      expect(cleared).toEqual([feed.id]);
      expect(
        Option.isNone(
          Option.getOrThrow(yield* feeds.find(alice, feed.id)).folderId
        )
      ).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const folderRefuseCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('writes nothing for an unknown or foreign folder', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const bobFolder = yield* storedFolder(bob);
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      const unknown = yield* feeds.update(alice, [feed.id], {
        folderId: Option.some(makeUniqueFolder().id),
      });
      const foreign = yield* feeds.update(alice, [feed.id], {
        folderId: Option.some(bobFolder.id),
      });
      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(unknown).toEqual([]);
      expect(foreign).toEqual([]);
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );

  it.effect('keeps the folder for a patch that only renames', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* feeds.create(alice, [feed]);

      const renamed = yield* feeds.update(alice, [feed.id], {
        title: FeedTitle.make('Renamed'),
      });
      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(renamed).toEqual([feed.id]);
      expect(stored.title).toBe('Renamed');
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );
};

export const folderCases = (layer: FeedStoreLayer) => (): void => {
  describe('create', createFolderCases(layer));
  describe('update', updateFolderCases(layer));
  describe('refused folder', folderRefuseCases(layer));
};
