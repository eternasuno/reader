import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import { type Folder, FolderName } from '../../../src/entity/feed/folder';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../../src/port/folder-repository';
import { createFolder } from '../../../src/usecase/feed/create-folder';
import { FolderAlreadyExists } from '../../../src/usecase/feed/errors';
import { alice } from '../../support/fixtures';
import { run } from '../../support/usecase/feed';

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
