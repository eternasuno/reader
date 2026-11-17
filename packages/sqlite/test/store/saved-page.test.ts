import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleTitle,
  NormalizedUrl,
  OwnerId,
  SavedPage,
  SavedPageRepository,
} from '@reader/business';
import { savedPageRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { readerStoreDatabaseLayer, savedPageStoreLayer } from '../support';

const alice = OwnerId.make('alice');

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeTitle = Schema.decodeSync(ArticleTitle);

const pageUrl = decodeUrl('https://example.com/page');

savedPageRepositoryContract('SQLite SavedPageRepository', savedPageStoreLayer);

it.effect('decodes a stored row without optional fields as none', () =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const sql = yield* SqlClient.SqlClient;
    const page = SavedPage.make({
      ownerId: alice,
      url: pageUrl,
      title: decodeTitle('Page'),
      description: Option.none(),
      content: ArticleContent.make('<p>Body</p>'),
      publishedAt: Option.none(),
      read: false,
    });
    yield* pages.create(alice, [page]);

    const rows =
      yield* sql`SELECT description, published_at AS publishedAt FROM saved_page WHERE id = ${page.id}`;

    expect(rows).toEqual([{ description: null, publishedAt: null }]);

    const stored = Option.getOrThrow(yield* pages.find(alice, page.id));

    expect(Option.isNone(stored.description)).toBe(true);
    expect(Option.isNone(stored.publishedAt)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
