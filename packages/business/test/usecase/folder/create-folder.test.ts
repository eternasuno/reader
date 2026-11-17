import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FolderName } from '../../../src/entity/folder/folder';
import { FolderRepository } from '../../../src/port/folder-repository';
import { createFolder } from '../../../src/usecase/folder/create-folder';
import { alice, bob, makeUniqueFolder } from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';

const run = <A, E>(
  effect: Effect.Effect<A, E, FolderRepository>
): Effect.Effect<A, E> => Effect.provide(effect, MemoryFeedStoreLive);

describe('createFolder', () => {
  it.effect('FD-FOLDER-4 creates the folder for the owner and returns it', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folder = yield* createFolder(alice, FolderName.make('Design'));
          const folders = yield* FolderRepository;

          return { folder, listed: yield* folders.list(alice) };
        })
      );

      expect(outcome.folder.name).toBe('Design');
      expect(outcome.folder.ownerId).toBe(alice);
      expect(outcome.listed.map((folder) => folder.id)).toEqual([
        outcome.folder.id,
      ]);
    })
  );
});

describe('createFolder', () => {
  it.effect(
    'FD-FOLDER-4 a name the owner already has fails FolderAlreadyExists and creates nothing',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const taken = makeUniqueFolder({
              ownerId: alice,
              name: FolderName.make('Design'),
            });

            yield* folders.create(alice, [taken]);
            const error = yield* createFolder(
              alice,
              FolderName.make('Design')
            ).pipe(Effect.flip);

            return { error, listed: yield* folders.list(alice) };
          })
        );

        expect(outcome.error._tag).toBe('FolderAlreadyExists');
        expect(outcome.listed).toHaveLength(1);
      })
  );
});

describe('createFolder duplicates', () => {
  it.effect(
    'CM-ID-3 each new folder carries a new id, greater than the one before',
    () =>
      Effect.gen(function* () {
        const [first, second] = yield* run(
          Effect.gen(function* () {
            const one = yield* createFolder(alice, FolderName.make('One'));
            const two = yield* createFolder(alice, FolderName.make('Two'));

            return [one, two] as const;
          })
        );

        expect(second.id).not.toBe(first.id);
        expect(second.id > first.id).toBe(true);
      })
  );
});

describe('createFolder ids and owners', () => {
  it.effect(
    'FD-FOLDER-1 two owners may each have a folder of the same name',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const mine = yield* createFolder(alice, FolderName.make('Tech'));
            const theirs = yield* createFolder(bob, FolderName.make('Tech'));

            return { mine, theirs };
          })
        );

        expect(outcome.mine.id).not.toBe(outcome.theirs.id);
        expect(outcome.theirs.ownerId).toBe(bob);
      })
  );
});
