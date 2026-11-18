import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedRow,
  makeFeed,
  makeUniqueFeed,
  storedFolder,
  updatedTime,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';
import { createCases } from './create';
import { folderCases } from './folder';
import {
  oldestListCases,
  preferenceCases,
  preferenceKeptCases,
} from './preference';
import { removalCases } from './removal';

const findCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-OWN-2 finds the stored feed of the owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      yield* feeds.create(alice, [feed]);

      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
        feed
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-OWN-3 reports a foreign feed and an unknown id as missing',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const feed = feedRow();
        yield* feeds.create(alice, [feed]);

        expect(Option.isNone(yield* feeds.find(bob, feed.id))).toBe(true);
        expect(Option.isNone(yield* feeds.find(alice, makeFeed().id))).toBe(
          true
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const listOrderCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-LIST-3 lists the feeds of the owner by title then id', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const sameFirst = feedRow('Same');
      const alpha = feedRow('Alpha');
      const sameSecond = feedRow('Same');
      yield* feeds.create(alice, [sameFirst, alpha, sameSecond]);
      yield* feeds.create(bob, [feedRow('Aardvark', bob)]);

      const listed = yield* feeds.list(alice);

      expect(listed.map((feed) => feed.id)).toEqual([
        alpha.id,
        sameFirst.id,
        sameSecond.id,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'FD-LIST-3 compares titles in UTF-8 byte order, not by locale',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const lower = feedRow('a');
        const upper = feedRow('B');
        const privateUse = feedRow('\uE000');
        const astral = feedRow('\u{1F600}');
        yield* feeds.create(alice, [lower, upper, privateUse, astral]);

        const listed = yield* feeds.list(alice);

        expect(listed.map((feed) => feed.title)).toEqual([
          'B',
          'a',
          '\uE000',
          '\u{1F600}',
        ]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const recordSyncCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-SYNC records the title and the sync time of the feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
      const at = updatedTime();
      yield* feeds.create(alice, [feed]);

      yield* feeds.recordSync(alice, feed.id, FeedTitle.make('Renamed'), at);

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(stored.title).toBe('Renamed');
      expect(Option.getOrThrow(stored.updatedAt).epochMilliseconds).toBe(
        at.epochMilliseconds
      );
      expect(Option.getOrThrow(stored.folderId)).toBe(folder.id);
      expect(stored.url).toEqual(feed.url);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-SYNC-5 changes nothing for an unknown or foreign feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);
      yield* feeds.create(bob, [foreign]);

      yield* feeds.recordSync(
        alice,
        foreign.id,
        FeedTitle.make('Renamed'),
        updatedTime()
      );
      yield* feeds.recordSync(
        alice,
        makeFeed().id,
        FeedTitle.make('Renamed'),
        updatedTime()
      );

      expect(Option.getOrThrow(yield* feeds.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const feedRepositoryContract = (makeLayer: FeedStoreFactory): void => {
  describe('FeedRepository', () => {
    describe('find', findCases(makeLayer));
    describe('list', listOrderCases(makeLayer));
    describe('create', createCases(makeLayer));
    describe('recordSync', recordSyncCases(makeLayer));
    describe('folder membership', folderCases(makeLayer));
    describe('preferences', preferenceCases(makeLayer));
    describe('preferences kept', preferenceKeptCases(makeLayer));
    describe('oldest first', oldestListCases(makeLayer));
    describe('remove', removalCases(makeLayer));
  });
};
