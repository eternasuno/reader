import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleTitle,
  SavedPage,
  SavedPageRepository,
} from '@reader/business';
import { savedPageRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { Database } from '../../src/infrastructure/db';
import {
  owner,
  query,
  readerStoreDatabaseLayer,
  savedPageStoreLayer,
  url,
} from './store-support';

const alice = owner('alice');

const decodeTitle = Schema.decodeSync(ArticleTitle);

let counter = 0;

const uniquePath = (path: string) => {
  counter += 1;

  return `https://example.com/${path}/${counter}`;
};

const pageRow = () =>
  SavedPage.make({
    ownerId: alice,
    url: url(uniquePath('page')),
    title: decodeTitle('Page'),
    description: Option.none(),
    content: ArticleContent.make('<p>Body</p>'),
    publishedAt: Option.none(),
    read: false,
  });

savedPageRepositoryContract(
  'SurrealDB SavedPageRepository',
  savedPageStoreLayer
);

it.effect('returns the existing ids when the patch changes nothing', () =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const page = pageRow();
    yield* pages.create(alice, [page]);

    expect(yield* pages.update(alice, [page.id], {})).toEqual([page.id]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('decodes a stored row without optional fields as none', () =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const db = yield* Database;
    const page = pageRow();
    yield* pages.create(alice, [page]);

    expect(
      yield* query(
        db,
        'SELECT description, publishedAt FROM saved_page WHERE pageId = $id;',
        { id: page.id }
      )
    ).toEqual([{}]);

    const stored = Option.getOrThrow(yield* pages.find(alice, page.id));

    expect(Option.isNone(stored.description)).toBe(true);
    expect(Option.isNone(stored.publishedAt)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
