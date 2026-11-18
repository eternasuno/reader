import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import {
  alice,
  bob,
  makeUniqueSavedPage,
  pageRow,
  uniqueUrl,
} from '../../fixtures';
import type { SavedPageStoreFactory } from '../layer';
import { createCases } from './create';
import { listCases } from './list';
import { readCases } from './read';

const findCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('SP-OPEN-1 finds the stored page of the owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'SP-OWN-1 reports a foreign page and an unknown id as missing',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const page = pageRow();
        yield* pages.create(alice, [page]);

        expect(Option.isNone(yield* pages.find(bob, page.id))).toBe(true);
        expect(Option.isNone(yield* pages.find(alice, pageRow().id))).toBe(
          true
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const findByUrlCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('CM-ID-7 looks a page up by url for the owner only', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(
        Option.getOrThrow(yield* pages.findByUrl(alice, page.url))
      ).toEqual(page);
      expect(Option.isNone(yield* pages.findByUrl(bob, page.url))).toBe(true);
      expect(
        Option.isNone(yield* pages.findByUrl(alice, uniqueUrl('page')))
      ).toBe(true);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SP-ID-2 finds each owner page for the same url', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const mine = makeUniqueSavedPage({ ownerId: alice, url });
      const theirs = makeUniqueSavedPage({ ownerId: bob, url });
      yield* pages.create(alice, [mine]);
      yield* pages.create(bob, [theirs]);

      expect(Option.getOrThrow(yield* pages.findByUrl(alice, url))).toEqual(
        mine
      );
      expect(Option.getOrThrow(yield* pages.findByUrl(bob, url))).toEqual(
        theirs
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const savedPageRepositoryContract = (
  makeLayer: SavedPageStoreFactory
): void => {
  describe('SavedPageRepository', () => {
    describe('find', findCases(makeLayer));
    describe('findByUrl', findByUrlCases(makeLayer));
    describe('list', listCases(makeLayer));
    describe('create', createCases(makeLayer));
    describe('read state, removal and count', readCases(makeLayer));
  });
};
