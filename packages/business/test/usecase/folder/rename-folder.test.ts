import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FolderName } from '../../../src/entity/folder/folder';
import type { FeedRepository } from '../../../src/port/feed-repository';
import { FolderRepository } from '../../../src/port/folder-repository';
import { renameFolder } from '../../../src/usecase/folder/rename-folder';
import { alice, bob, makeUniqueFolder } from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';

const storeLayer = MemoryFeedStoreLive;

const run = <A, E>(
  effect: Effect.Effect<A, E, FolderRepository | FeedRepository>
): Effect.Effect<A, E> => Effect.provide(effect, storeLayer);

describe('renameFolder', () => {
  it.effect('FD-FOLDER-5 renames the folder and changes no feed', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const folder = makeUniqueFolder({
            ownerId: alice,
            name: FolderName.make('Tech'),
          });

          yield* folders.create(alice, [folder]);
          yield* renameFolder(alice, folder.id, FolderName.make('Engineering'));

          return { found: yield* folders.find(alice, folder.id) };
        })
      );

      expect(Option.getOrThrow(outcome.found).name).toBe('Engineering');
    })
  );
});

describe('renameFolder', () => {
  it.effect(
    'FD-FOLDER-5 renaming to the current name succeeds and changes nothing',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const folder = makeUniqueFolder({
              ownerId: alice,
              name: FolderName.make('Tech'),
            });

            yield* folders.create(alice, [folder]);
            yield* renameFolder(alice, folder.id, FolderName.make('Tech'));

            return { found: yield* folders.find(alice, folder.id) };
          })
        );

        expect(Option.getOrThrow(outcome.found).name).toBe('Tech');
      })
  );
});

describe('renameFolder failures', () => {
  it.effect('FD-FOLDER-5 an unknown folder fails FolderNotFound', () =>
    Effect.gen(function* () {
      const folder = makeUniqueFolder({ ownerId: alice });

      const error = yield* run(
        renameFolder(alice, folder.id, FolderName.make('Engineering'))
      ).pipe(Effect.flip);

      expect(error._tag).toBe('FolderNotFound');
    })
  );
});

describe('renameFolder unknown folders', () => {
  it.effect('FD-FOLDER-5 a folder of another owner fails FolderNotFound', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const folder = makeUniqueFolder({
            ownerId: bob,
            name: FolderName.make('Tech'),
          });

          yield* folders.create(bob, [folder]);

          const error = yield* renameFolder(
            alice,
            folder.id,
            FolderName.make('Engineering')
          ).pipe(Effect.flip);

          return { error, found: yield* folders.find(bob, folder.id) };
        })
      );

      expect(outcome.error._tag).toBe('FolderNotFound');
      expect(Option.getOrThrow(outcome.found).name).toBe('Tech');
    })
  );
});

describe('renameFolder name failures', () => {
  it.effect(
    'FD-FOLDER-5 a name the owner already uses fails FolderAlreadyExists and keeps the old name',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const tech = makeUniqueFolder({
              ownerId: alice,
              name: FolderName.make('Tech'),
            });
            const news = makeUniqueFolder({
              ownerId: alice,
              name: FolderName.make('News'),
            });

            yield* folders.create(alice, [tech, news]);

            const error = yield* renameFolder(
              alice,
              tech.id,
              FolderName.make('News')
            ).pipe(Effect.flip);

            return { error, found: yield* folders.find(alice, tech.id) };
          })
        );

        expect(outcome.error._tag).toBe('FolderAlreadyExists');
        expect(Option.getOrThrow(outcome.found).name).toBe('Tech');
      })
  );
});
