import { describe, expect, it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import { type Folder, FolderName } from '../../../src/entity/feed/folder';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../../src/port/folder-repository';
import { createFolder } from '../../../src/usecase/feed/create-folder';
import { FolderAlreadyExists } from '../../../src/usecase/feed/errors';
import { alice, bob } from '../../support';
import { run } from './support';

const name = (value: string): FolderName => FolderName.make(value);

const foldersOf = (
  owner: OwnerId
): Effect.Effect<
  ReadonlyArray<Folder>,
  FolderRepositoryError,
  FolderRepository
> => Effect.flatMap(FolderRepository, (folders) => folders.list(owner));

describe('createFolder', () => {
  it.effect('FD-FOLDER-4 creates an empty folder with the given name', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* createFolder(alice, name('Tech'));

          return { folder, folders: yield* foldersOf(alice) };
        })
      );

      expect(result.folder.ownerId).toBe(alice);
      expect(result.folder.name).toBe('Tech');
      expect(result.folders).toStrictEqual([result.folder]);
    })
  );
});

describe('createFolder duplicates', () => {
  it.effect('FD-FOLDER-4 fails a taken name and creates no second folder', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* createFolder(alice, name('Tech'));
          const error = yield* createFolder(alice, name('Tech')).pipe(
            Effect.flip
          );

          return { folder, error, folders: yield* foldersOf(alice) };
        })
      );

      expect(result.error).toStrictEqual(
        new FolderAlreadyExists({ folderName: result.folder.name })
      );
      expect(result.folders).toStrictEqual([result.folder]);
    })
  );
});

describe('createFolder names', () => {
  it.effect('FD-FOLDER-2 names differing only in case are two folders', () =>
    Effect.gen(function* () {
      const folders = yield* run(
        Effect.gen(function* () {
          yield* createFolder(alice, name('Tech'));
          yield* createFolder(alice, name('tech'));

          return yield* foldersOf(alice);
        })
      );

      expect(folders.map((folder) => folder.name)).toEqual(['Tech', 'tech']);
    })
  );

  it.effect('FD-FOLDER-1 the same name for two owners is two folders', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const theirFolder = yield* createFolder(bob, name('Tech'));
          const myFolder = yield* createFolder(alice, name('Tech'));

          return {
            theirFolder,
            myFolder,
            theirs: yield* foldersOf(bob),
            mine: yield* foldersOf(alice),
          };
        })
      );

      expect(result.theirs).toStrictEqual([result.theirFolder]);
      expect(result.mine).toStrictEqual([result.myFolder]);
      expect(result.myFolder.id).not.toBe(result.theirFolder.id);
    })
  );
});

describe('createFolder races', () => {
  it.effect('FD-FOLDER-4 two concurrent creates make exactly one folder', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const results = yield* Effect.all(
            [
              createFolder(alice, name('Tech')),
              createFolder(alice, name('Tech')),
            ],
            { concurrency: 'unbounded', mode: 'result' }
          );

          return { results, folders: yield* foldersOf(alice) };
        })
      );
      const succeeded = result.results.filter(Result.isSuccess);

      expect(succeeded).toHaveLength(1);
      expect(result.folders).toHaveLength(1);
    })
  );
});
