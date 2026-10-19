import { expect, it } from '@effect/vitest';
import {
  LinkTitle,
  listLinks,
  markLink,
  removeLink,
  saveLink as saveReadingLink,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { LinkRepositoryLive } from '../../src/adapter/link-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { linksSchema } from '../../src/infrastructure/links';

const saveLink = (owner: string, url: string, _title: string) =>
  saveReadingLink(owner, url).pipe(Effect.map(({ item }) => item));

const changeLink = (owner: string, key: string, read: boolean | undefined) =>
  (read === undefined
    ? removeLink(owner, key)
    : markLink(owner, key, read)
  ).pipe(
    Effect.as(true),
    Effect.catchTag('LinkNotFound', () => Effect.succeed(false))
  );

const verifyReadingLists = Effect.gen(function* () {
  const db = yield* Database;
  yield* Effect.promise(() => db.query(linksSchema));
  const first = yield* saveLink('alice', 'https://example.com/', 'Example');
  expect(first?.read).toBe(false);
  expect(
    (yield* Effect.flip(saveLink('alice', 'https://example.com/', 'Duplicate')))
      ._tag
  ).toBe('DuplicateLink');
  expect((yield* listLinks('bob', false, 0)).items).toEqual([]);
  expect(yield* changeLink('bob', first?.key ?? '', true)).toBe(false);
  expect(yield* changeLink('bob', first?.key ?? '', undefined)).toBe(false);
  expect(yield* changeLink('alice', first?.key ?? '', true)).toBe(true);
  expect((yield* listLinks('alice', false, 0)).items).toEqual([]);
  expect((yield* listLinks('alice', true, 0)).items[0]?.title).toBe('Example');
  expect(yield* changeLink('alice', first?.key ?? '', false)).toBe(true);
  expect(yield* changeLink('alice', first?.key ?? '', undefined)).toBe(true);
  expect((yield* listLinks('alice', false, 0)).items).toEqual([]);
  for (let index = 0; index < 31; index++) {
    yield* saveLink(
      'alice',
      `https://example.com/${index}`,
      `Article ${index}`
    );
  }

  const page = yield* listLinks('alice', false, 0);
  expect(page.items).toHaveLength(30);
  expect(page.hasMore).toBe(true);
  expect((yield* listLinks('alice', false, 30)).items).toHaveLength(1);
});

it.effect(
  'persists isolated reading lists, prevents duplicates and scopes mutations',
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        createSurreal({
          endpoint: 'mem://',
          namespace: 'links-test',
          database: 'links',
        })
      ),
      (db) =>
        verifyReadingLists.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Database, db),
              LinkRepositoryLive.pipe(
                Layer.provide(Layer.succeed(Database, db))
              ),
              Layer.succeed(LinkTitle, {
                fetch: () => Effect.succeed('Example'),
              })
            )
          )
        ),
      (db) => Effect.promise(() => db.close())
    )
);
