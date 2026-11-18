import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FolderName } from '../../../../src/entity/folder/folder';
import { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  folderRow,
  idsOf,
  makeUniqueFolder,
  sortedIds,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const resultCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-PORT-6 returns the ids of the created folders', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const first = folderRow('Alpha');
      const second = folderRow('Beta');

      expect(sortedIds(yield* folders.create(alice, [first, second]))).toEqual(
        sortedIds(idsOf([first, second]))
      );
      expect(yield* folders.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const idSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose id exists without overwriting it',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const folder = folderRow('Original');
        yield* folders.create(alice, [folder]);
        const duplicate = makeUniqueFolder({
          id: folder.id,
          ownerId: alice,
          name: FolderName.make('Contender'),
        });

        expect(yield* folders.create(alice, [duplicate])).toEqual([]);
        expect(
          Option.getOrThrow(yield* folders.find(alice, folder.id))
        ).toEqual(folder);
        expect(yield* folders.list(alice)).toEqual([folder]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const nameSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-ID-6 skips a name the owner already has', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const stored = folderRow('Tech');
      yield* folders.create(alice, [stored]);

      expect(yield* folders.create(alice, [folderRow('Tech')])).toEqual([]);
      expect(yield* folders.list(alice)).toEqual([stored]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-PORT-6 skips a row whose owner is not the owner passed in',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const foreign = folderRow('Alpha', bob);

        expect(yield* folders.create(alice, [foreign])).toEqual([]);
        expect(yield* folders.list(alice)).toEqual([]);
        expect(yield* folders.list(bob)).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const nameCaseCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-FOLDER-2 stores names differing only in case as two folders',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const lower = folderRow('tech');
        const upper = folderRow('Tech');

        expect(sortedIds(yield* folders.create(alice, [lower, upper]))).toEqual(
          sortedIds(idsOf([lower, upper]))
        );
        expect(yield* folders.list(alice)).toHaveLength(2);
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'FD-FOLDER-1 stores the same name for two owners as two folders',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const mine = folderRow('Tech');
        const theirs = folderRow('Tech', bob);

        expect(yield* folders.create(alice, [mine])).toEqual([mine.id]);
        expect(yield* folders.create(bob, [theirs])).toEqual([theirs.id]);
        expect(yield* folders.list(alice)).toEqual([mine]);
        expect(yield* folders.list(bob)).toEqual([theirs]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const concurrentCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-FOLDER-4 creates one folder for two concurrent creates of one name',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const first = folderRow('Tech');
        const second = folderRow('Tech');
        const created = yield* Effect.all(
          [folders.create(alice, [first]), folders.create(alice, [second])],
          { concurrency: 'unbounded' }
        );

        expect(created[0].length + created[1].length).toBe(1);
        expect(yield* folders.list(alice)).toHaveLength(1);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const createCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('result', resultCases(makeLayer));
  describe('existing id', idSkipCases(makeLayer));
  describe('existing name', nameSkipCases(makeLayer));
  describe('same name twice', nameCaseCases(makeLayer));
  describe('concurrent creates', concurrentCases(makeLayer));
};
