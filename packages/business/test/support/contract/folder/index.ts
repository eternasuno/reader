import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  folderRow,
  idsOf,
  makeUniqueFolder,
  storedFolderFeed,
} from '../../fixtures';
import type { FeedStoreLayer } from '../feed';
import { createCases } from './create';
import { removalCases } from './removal';
import { updateCases } from './rename';

const findCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the stored folder of the owner', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('reports a foreign folder and an unknown id as missing', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      expect(Option.isNone(yield* folders.find(bob, folder.id))).toBe(true);
      expect(
        Option.isNone(yield* folders.find(alice, makeUniqueFolder().id))
      ).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const listCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('lists the folders of the owner by name', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const gamma = folderRow('Gamma');
      const alpha = folderRow('Alpha');
      const beta = folderRow('Beta');
      yield* folders.create(alice, [gamma, alpha, beta]);
      yield* folders.create(bob, [folderRow('Aardvark', bob)]);

      const listed = yield* folders.list(alice);

      expect(listed.map((folder) => folder.name)).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ]);
      expect(idsOf(listed)).toEqual([alpha.id, beta.id, gamma.id]);
    }).pipe(Effect.provide(layer))
  );

  it.effect(
    'FD-FOLDER-8 lists every folder, including one that lost its last feed',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const feeds = yield* FeedRepository;
        const alpha = folderRow('Alpha');
        const movedOut = folderRow('Beta');
        const unsubscribed = folderRow('Gamma');
        const delta = folderRow('Delta');
        yield* folders.create(alice, [alpha, movedOut, unsubscribed, delta]);
        const moved = yield* storedFolderFeed(movedOut.id);
        const removed = yield* storedFolderFeed(unsubscribed.id);
        yield* feeds.moveToFolder(alice, moved.id, Option.none());
        yield* feeds.remove(alice, [removed.id]);

        expect(idsOf(yield* folders.list(alice))).toEqual([
          alpha.id,
          movedOut.id,
          delta.id,
          unsubscribed.id,
        ]);
      }).pipe(Effect.provide(layer))
  );
};

export const folderRepositoryContract = (
  name: string,
  layer: FeedStoreLayer
): void => {
  describe(name, () => {
    describe('find', findCases(layer));
    describe('list', listCases(layer));
    describe('create', createCases(layer));
    describe('rename', updateCases(layer));
    describe('remove', removalCases(layer));
  });
};
