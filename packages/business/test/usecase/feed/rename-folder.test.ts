import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import { type Folder, FolderName } from '../../../src/entity/feed/folder';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../../src/port/folder-repository';
import {
  FolderAlreadyExists,
  FolderNotFound,
} from '../../../src/usecase/feed/errors';
import { renameFolder } from '../../../src/usecase/feed/rename-folder';
import { alice, makeFolder, storedFolder } from '../../support/fixtures';
import { run } from '../../support/usecase/feed';

const name = (value: string): FolderName => FolderName.make(value);

const foldersOf = (
  owner: OwnerId
): Effect.Effect<
  ReadonlyArray<Folder>,
  FolderRepositoryError,
  FolderRepository
> => Effect.flatMap(FolderRepository, (folders) => folders.list(owner));

describe('renameFolder', () => {
  it.effect('FD-FOLDER-5 renames the folder', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);

          yield* renameFolder(alice, folder.id, name('Renamed'));

          return { folder, folders: yield* foldersOf(alice) };
        })
      );

      expect(result.folders).toStrictEqual([
        { ...result.folder, name: name('Renamed') },
      ]);
    })
  );
});

describe('renameFolder duplicates', () => {
  it.effect('FD-FOLDER-5 a taken name fails and keeps the old name', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const taken = yield* storedFolder(alice);
          const folder = yield* storedFolder(alice);
          const error = yield* renameFolder(alice, folder.id, taken.name).pipe(
            Effect.flip
          );

          return { taken, folder, error, folders: yield* foldersOf(alice) };
        })
      );

      expect(result.error).toStrictEqual(
        new FolderAlreadyExists({ folderName: result.taken.name })
      );
      expect(new Set(result.folders.map((folder) => folder.name))).toEqual(
        new Set([result.taken.name, result.folder.name])
      );
    })
  );
});

describe('renameFolder unknown folders', () => {
  it.effect('FD-FOLDER-5 an unknown folder id fails FolderNotFound', () =>
    Effect.gen(function* () {
      const unknown = makeFolder({ ownerId: alice }).id;
      const error = yield* run(
        renameFolder(alice, unknown, name('Renamed')).pipe(Effect.flip)
      );

      expect(error).toStrictEqual(new FolderNotFound({ id: unknown }));
    })
  );
});
