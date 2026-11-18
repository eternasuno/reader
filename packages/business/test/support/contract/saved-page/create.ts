import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../../src/entity/common/article';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import {
  alice,
  bob,
  decodeTitle,
  idsOf,
  makeUniqueSavedPage,
  pageRow,
  savedPageQuery,
  sortedIds,
  uniqueUrl,
} from '../../fixtures';
import type { SavedPageStoreFactory } from '../layer';

const resultCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('CM-PORT-6 returns the ids of the created pages', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();

      expect(sortedIds(yield* pages.create(alice, [first, second]))).toEqual(
        sortedIds(idsOf([first, second]))
      );
      expect(yield* pages.list(alice, savedPageQuery())).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const idSkipCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose id exists without overwriting it',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const page = makeUniqueSavedPage({
          title: decodeTitle('Original'),
          content: ArticleContent.make('<p>Original</p>'),
        });
        yield* pages.create(alice, [page]);
        const duplicate = makeUniqueSavedPage({
          id: page.id,
          ownerId: alice,
          url: page.url,
          title: decodeTitle('Contender'),
          content: ArticleContent.make('<p>Contender</p>'),
          read: true,
        });

        expect(yield* pages.create(alice, [duplicate])).toEqual([]);
        expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
          page
        );
        expect(yield* pages.list(alice, savedPageQuery())).toEqual([page]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const urlSkipCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('CM-ID-6 skips a row whose url the owner already saved', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const stored = makeUniqueSavedPage({
        url,
        title: decodeTitle('Original'),
      });
      yield* pages.create(alice, [stored]);
      const contender = makeUniqueSavedPage({
        url,
        title: decodeTitle('Contender'),
        read: true,
      });

      expect(yield* pages.create(alice, [contender])).toEqual([]);
      expect(Option.getOrThrow(yield* pages.findByUrl(alice, url))).toEqual(
        stored
      );
      expect(yield* pages.list(alice, savedPageQuery())).toEqual([stored]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const ownerSkipCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose owner is not the owner passed in',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const foreign = pageRow(bob);

        expect(yield* pages.create(alice, [foreign])).toEqual([]);
        expect(yield* pages.list(alice, savedPageQuery())).toEqual([]);
        expect(yield* pages.list(bob, savedPageQuery())).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SP-ID-2 stores the same url for two owners as two pages', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const mine = makeUniqueSavedPage({ ownerId: alice, url });
      const theirs = makeUniqueSavedPage({ ownerId: bob, url });

      expect(yield* pages.create(alice, [mine])).toEqual([mine.id]);
      expect(yield* pages.create(bob, [theirs])).toEqual([theirs.id]);
      expect(yield* pages.list(alice, savedPageQuery())).toEqual([mine]);
      expect(yield* pages.list(bob, savedPageQuery())).toEqual([theirs]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const concurrentCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect(
    'SP-ADD-5 creates one page when one url is created twice at once',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const url = uniqueUrl('page');
        const created = yield* Effect.all(
          [
            pages.create(alice, [makeUniqueSavedPage({ url })]),
            pages.create(alice, [makeUniqueSavedPage({ url })]),
          ],
          { concurrency: 'unbounded' }
        );

        expect(created[0].length + created[1].length).toBe(1);
        expect(yield* pages.list(alice, savedPageQuery())).toHaveLength(1);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const createCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  describe('result', resultCases(makeLayer));
  describe('existing id', idSkipCases(makeLayer));
  describe('existing url', urlSkipCases(makeLayer));
  describe('owner', ownerSkipCases(makeLayer));
  describe('concurrent creates', concurrentCases(makeLayer));
};
