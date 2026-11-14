import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FolderName } from '../../../../src/entity/feed/folder';
import { FolderRepository } from '../../../../src/port/folder-repository';
import { alice, bob, folderRow, makeUniqueFolder } from '../../fixtures';
import type { FeedStoreLayer } from '../feed';

const resultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the ids of the created folders', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const first = folderRow('Alpha');
      const second = folderRow('Beta');

      expect(yield* folders.create(alice, [first, second])).toEqual([
        first.id,
        second.id,
      ]);
      expect(yield* folders.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(layer))
  );
};

const idSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a row whose id exists without overwriting it', () =>
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
      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
      );
      expect(yield* folders.list(alice)).toEqual([folder]);
    }).pipe(Effect.provide(layer))
  );
};

const nameSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a name the owner already has', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const stored = folderRow('Tech');
      yield* folders.create(alice, [stored]);
      const contender = folderRow('Tech');

      expect(yield* folders.create(alice, [contender])).toEqual([]);
      expect(yield* folders.list(alice)).toEqual([stored]);
    }).pipe(Effect.provide(layer))
  );

  it.effect('skips a row of another owner', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const foreign = folderRow('Alpha', bob);

      expect(yield* folders.create(alice, [foreign])).toEqual([]);
      expect(yield* folders.list(alice)).toEqual([]);
      expect(yield* folders.list(bob)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const nameUniqueCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('stores the same name for two owners as two folders', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const mine = folderRow('Tech');
      const other = folderRow('Tech', bob);

      expect(yield* folders.create(alice, [mine])).toEqual([mine.id]);
      expect(yield* folders.create(bob, [other])).toEqual([other.id]);
    }).pipe(Effect.provide(layer))
  );

  it.effect('stores names differing only in case as two folders', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const lower = folderRow('tech');
      const upper = folderRow('Tech');

      expect(yield* folders.create(alice, [lower, upper])).toEqual([
        lower.id,
        upper.id,
      ]);
      expect(yield* folders.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(layer))
  );

  it.effect('creates one folder when one name is created at once', () =>
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
    }).pipe(Effect.provide(layer))
  );
};

export const createCases = (layer: FeedStoreLayer) => (): void => {
  describe('result', resultCases(layer));
  describe('skips', () => {
    describe('existing id', idSkipCases(layer));
    describe('existing name and foreign owner', nameSkipCases(layer));
  });
  describe('unique name per owner', nameUniqueCases(layer));
};
