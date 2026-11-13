import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FolderName } from '../../../../src/entity/feed/folder';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  folderRow,
  makeUniqueFeed,
  makeUniqueFolder,
} from '../../fixtures';
import type { FeedStoreLayer } from '../feed';

const resultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('renames the folder and returns true', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      const renamed = yield* folders.rename(
        alice,
        folder.id,
        FolderName.make('Beta')
      );
      const stored = Option.getOrThrow(yield* folders.find(alice, folder.id));

      expect(renamed).toBe(true);
      expect(stored.name).toBe('Beta');
    }).pipe(Effect.provide(layer))
  );

  it.effect('returns the current name as a successful rename', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      const renamed = yield* folders.rename(
        alice,
        folder.id,
        FolderName.make('Alpha')
      );

      expect(renamed).toBe(true);
      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
      );
    }).pipe(Effect.provide(layer))
  );
};

const idCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns false for an unknown or foreign folder', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const name = FolderName.make('Beta');
      const foreign = folderRow('Gamma', bob);
      yield* folders.create(bob, [foreign]);

      const refused = yield* folders.rename(alice, foreign.id, name);
      const unknown = yield* folders.rename(alice, makeUniqueFolder().id, name);

      expect(refused).toBe(false);
      expect(unknown).toBe(false);
      expect(Option.getOrThrow(yield* folders.find(bob, foreign.id)).name).toBe(
        'Gamma'
      );
    }).pipe(Effect.provide(layer))
  );
};

const takenNameCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('does not write a name that another folder of the owner has', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const taken = folderRow('Tech');
      const folder = folderRow('News');
      yield* folders.create(alice, [taken, folder]);

      const renamed = yield* folders.rename(
        alice,
        folder.id,
        FolderName.make('Tech')
      );
      const stored = Option.getOrThrow(yield* folders.find(alice, folder.id));

      expect(renamed).toBe(false);
      expect(stored.name).toBe('News');
    }).pipe(Effect.provide(layer))
  );

  it.effect('renames one of two folders when both take one name at once', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const first = folderRow('Alpha');
      const second = folderRow('Beta');
      const name = FolderName.make('Gamma');
      yield* folders.create(alice, [first, second]);
      const renamed = yield* Effect.all(
        [
          folders.rename(alice, first.id, name),
          folders.rename(alice, second.id, name),
        ],
        { concurrency: 'unbounded' }
      );
      const listed = yield* folders.list(alice);

      expect(renamed.filter(Boolean)).toHaveLength(1);
      expect(listed).toHaveLength(2);
      expect(listed.filter((folder) => folder.name === 'Gamma')).toHaveLength(
        1
      );
    }).pipe(Effect.provide(layer))
  );
};

const keepsFeedsCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-FOLDER-5 rename keeps the feeds of the folder in it', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const feeds = yield* FeedRepository;
      const folder = folderRow('Alpha');
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      yield* folders.create(alice, [folder]);
      yield* feeds.create(alice, [feed]);

      yield* folders.rename(alice, folder.id, FolderName.make('Renamed'));

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(layer))
  );
};

export const updateCases = (layer: FeedStoreLayer) => (): void => {
  describe('result', resultCases(layer));
  describe('given ids', idCases(layer));
  describe('taken name', takenNameCases(layer));
  describe('keeps the feeds', keepsFeedsCases(layer));
};
