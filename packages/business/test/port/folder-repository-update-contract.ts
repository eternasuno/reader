import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { FolderId } from '../../src/entity/feed/folder';
import { FolderName } from '../../src/entity/feed/folder';
import { FolderRepository } from '../../src/port/folder-repository';
import { alice, bob, makeUniqueFolder } from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';
import { folderRow } from './feed-store-row';

const resultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('renames the folder and returns its id', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      const renamed = yield* folders.update(alice, [folder.id], {
        name: FolderName.make('Beta'),
      });
      const stored = Option.getOrThrow(yield* folders.find(alice, folder.id));

      expect(renamed).toEqual([folder.id]);
      expect(stored.name).toBe('Beta');
    }).pipe(Effect.provide(layer))
  );

  it.effect('returns the current name as a successful rename', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      const renamed = yield* folders.update(alice, [folder.id], {
        name: FolderName.make('Alpha'),
      });

      expect(renamed).toEqual([folder.id]);
      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
      );
    }).pipe(Effect.provide(layer))
  );
};

const idCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'returns each existing id once and ignores foreign and unknown',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const first = folderRow('Alpha');
        const second = folderRow('Beta');
        const foreign = folderRow('Gamma', bob);
        yield* folders.create(alice, [first, second]);
        yield* folders.create(bob, [foreign]);

        const updated = yield* folders.update(
          alice,
          [first.id, foreign.id, second.id, first.id, makeUniqueFolder().id],
          {}
        );

        expect(updated).toHaveLength(2);
        expect(new Set(updated)).toEqual(
          new Set<FolderId>([first.id, second.id])
        );
        expect(
          Option.getOrThrow(yield* folders.find(bob, foreign.id)).name
        ).toBe('Gamma');
      }).pipe(Effect.provide(layer))
  );

  it.effect('changes nothing and returns nothing for an empty id list', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      const updated = yield* folders.update(alice, [], {
        name: FolderName.make('Beta'),
      });

      expect(updated).toEqual([]);
      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
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

      const updated = yield* folders.update(alice, [folder.id], {
        name: FolderName.make('Tech'),
      });
      const stored = Option.getOrThrow(yield* folders.find(alice, folder.id));

      expect(updated).toEqual([]);
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
          folders.update(alice, [first.id], { name }),
          folders.update(alice, [second.id], { name }),
        ],
        { concurrency: 'unbounded' }
      );
      const listed = yield* folders.list(alice);

      expect(renamed[0].length + renamed[1].length).toBe(1);
      expect(listed).toHaveLength(2);
      expect(listed.filter((folder) => folder.name === 'Gamma')).toHaveLength(
        1
      );
    }).pipe(Effect.provide(layer))
  );
};

export const updateCases = (layer: FeedStoreLayer) => (): void => {
  describe('result', resultCases(layer));
  describe('given ids', idCases(layer));
  describe('taken name', takenNameCases(layer));
};
