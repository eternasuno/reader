import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../../src/entity/common/article';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import {
  alice,
  bob,
  decodeTitle,
  makeUniqueSavedPage,
  pageRow,
  uniqueUrl,
} from '../../fixtures';
import type { SavedPageStoreLayer } from '.';

const createResultCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('returns the ids of the created pages', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();

      expect(yield* pages.create(alice, [first, second])).toEqual([
        first.id,
        second.id,
      ]);
      expect(
        yield* pages.list(alice, { limit: 10, unreadOnly: false })
      ).toHaveLength(2);
    }).pipe(Effect.provide(layer))
  );
};

const createIdSkipCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('skips a row whose id exists without overwriting it', () =>
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
      expect(
        yield* pages.list(alice, { limit: 10, unreadOnly: false })
      ).toEqual([page]);
    }).pipe(Effect.provide(layer))
  );
};

const createIdUrlCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('keeps a row whose id exists under another url', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = makeUniqueSavedPage({ title: decodeTitle('Original') });
      yield* pages.create(alice, [page]);
      const moved = makeUniqueSavedPage({
        id: page.id,
        ownerId: alice,
        title: decodeTitle('Moved'),
      });

      expect(yield* pages.create(alice, [moved])).toEqual([]);
      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
      expect(Option.isNone(yield* pages.findByUrl(alice, moved.url))).toBe(
        true
      );
    }).pipe(Effect.provide(layer))
  );
};

const createUrlSkipCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('skips a row whose url the owner already saved', () =>
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
      expect(
        yield* pages.list(alice, { limit: 10, unreadOnly: false })
      ).toEqual([stored]);
    }).pipe(Effect.provide(layer))
  );
};

const createOwnerSkipCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('skips a row of another owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const foreign = pageRow(bob);

      expect(yield* pages.create(alice, [foreign])).toEqual([]);
      expect(yield* pages.list(bob, { limit: 10, unreadOnly: false })).toEqual(
        []
      );
    }).pipe(Effect.provide(layer))
  );
};

const createUniqueCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('stores the same url for two owners as two pages', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const mine = makeUniqueSavedPage({ ownerId: alice, url });
      const other = makeUniqueSavedPage({ ownerId: bob, url });

      expect(yield* pages.create(alice, [mine])).toEqual([mine.id]);
      expect(yield* pages.create(bob, [other])).toEqual([other.id]);
      expect(
        yield* pages.list(alice, { limit: 10, unreadOnly: false })
      ).toHaveLength(1);
      expect(
        yield* pages.list(bob, { limit: 10, unreadOnly: false })
      ).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );

  it.effect('creates one page when the same url is created at once', () =>
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
      expect(
        yield* pages.list(alice, { limit: 10, unreadOnly: false })
      ).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );
};

export const createCases = (layer: SavedPageStoreLayer) => (): void => {
  describe('result', createResultCases(layer));
  describe('skips', () => {
    describe('existing id', createIdSkipCases(layer));
    describe('existing id under another url', createIdUrlCases(layer));
    describe('existing url', createUrlSkipCases(layer));
    describe('foreign owner', createOwnerSkipCases(layer));
  });
  describe('unique url per owner', createUniqueCases(layer));
};
