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
import type { FeedStoreFactory } from '../layer';
import { createCases } from './create';
import { removalCases } from './removal';
import { renameCases } from './rename';

const findCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-OWN-2 finds the stored folder of the owner', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = folderRow('Alpha');
      yield* folders.create(alice, [folder]);

      expect(Option.getOrThrow(yield* folders.find(alice, folder.id))).toEqual(
        folder
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-OWN-3 reports a foreign folder and an unknown id as missing',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const folder = folderRow('Alpha');
        yield* folders.create(alice, [folder]);

        expect(Option.isNone(yield* folders.find(bob, folder.id))).toBe(true);
        expect(
          Option.isNone(yield* folders.find(alice, makeUniqueFolder().id))
        ).toBe(true);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const listOrderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-FOLDER-8 lists the folders of the owner by name then id', () =>
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
    }).pipe(Effect.provide(makeLayer()))
  );
};

const listByteOrderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-FOLDER-8 compares names in UTF-8 byte order, not by locale',
    () =>
      Effect.gen(function* () {
        const folders = yield* FolderRepository;
        const lower = folderRow('a');
        const upper = folderRow('B');
        const privateUse = folderRow('\uE000');
        const astral = folderRow('\u{1F600}');
        yield* folders.create(alice, [lower, upper, privateUse, astral]);

        const listed = yield* folders.list(alice);

        expect(listed.map((folder) => folder.name)).toEqual([
          'B',
          'a',
          '\uE000',
          '\u{1F600}',
        ]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const listEmptyFolderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-FOLDER-8 keeps an empty folder after its last feed left', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const feeds = yield* FeedRepository;
      const kept = folderRow('Alpha');
      const emptied = folderRow('Beta');
      const unsubscribed = folderRow('Gamma');
      yield* folders.create(alice, [kept, emptied, unsubscribed]);
      const moved = yield* storedFolderFeed(emptied.id);
      const removed = yield* storedFolderFeed(unsubscribed.id);
      yield* feeds.moveToFolder(alice, moved.id, Option.none());
      yield* feeds.remove(alice, [removed.id]);

      expect(idsOf(yield* folders.list(alice))).toEqual([
        kept.id,
        emptied.id,
        unsubscribed.id,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const folderRepositoryContract = (makeLayer: FeedStoreFactory): void => {
  describe('FolderRepository', () => {
    describe('find', findCases(makeLayer));
    describe('list', () => {
      listOrderCase(makeLayer);
      listByteOrderCase(makeLayer);
      listEmptyFolderCase(makeLayer);
    });
    describe('create', createCases(makeLayer));
    describe('rename', renameCases(makeLayer));
    describe('remove', removalCases(makeLayer));
  });
};
