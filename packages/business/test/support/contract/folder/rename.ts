import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FolderName } from '../../../../src/entity/folder/folder';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  folderFeedRow,
  folderRow,
  makeUniqueFolder,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const renameCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-PORT-5 rename sets the name and returns true', () =>
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
      expect(stored.id).toBe(folder.id);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const renameCurrentNameCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-FOLDER-5 renaming to the current name succeeds unchanged', () =>
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
    }).pipe(Effect.provide(makeLayer()))
  );
};

const renameCaseSensitiveCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-FOLDER-2 renaming to another case is a new name', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const upper = folderRow('Tech');
      const lower = folderRow('News');
      yield* folders.create(alice, [upper, lower]);

      const renamed = yield* folders.rename(
        alice,
        lower.id,
        FolderName.make('tech')
      );

      expect(renamed).toBe(true);
      expect(Option.getOrThrow(yield* folders.find(alice, lower.id)).name).toBe(
        'tech'
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const refusedRenameCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-PORT-5 returns false for an unknown or foreign folder', () =>
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
    }).pipe(Effect.provide(makeLayer()))
  );
};

const takenNameCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-FOLDER-5 writes no name that another folder of the owner has',
    () =>
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

        expect(renamed).toBe(false);
        expect(
          Option.getOrThrow(yield* folders.find(alice, folder.id)).name
        ).toBe('News');
      }).pipe(Effect.provide(makeLayer()))
  );
};

const racingRenameCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-FOLDER-5 renames one of two folders racing for one name', () =>
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
      expect(listed.filter((folder) => folder.name === 'Gamma')).toHaveLength(
        1
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const keepsFeedsCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-FOLDER-5 rename keeps the feeds of the folder in it', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const feeds = yield* FeedRepository;
      const folder = folderRow('Alpha');
      const feed = folderFeedRow(folder.id);
      yield* folders.create(alice, [folder]);
      yield* feeds.create(alice, [feed]);

      yield* folders.rename(alice, folder.id, FolderName.make('Renamed'));

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const renameCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('result', () => {
    renameCase(makeLayer);
    renameCurrentNameCase(makeLayer);
    renameCaseSensitiveCase(makeLayer);
  });
  describe('refused write', () => {
    refusedRenameCase(makeLayer);
    takenNameCase(makeLayer);
    racingRenameCase(makeLayer);
  });
  describe('keeps the feeds', keepsFeedsCases(makeLayer));
};
