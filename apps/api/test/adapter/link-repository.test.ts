import { expect, it } from '@effect/vitest';
import {
  countUnreadLinks,
  LinkTitle,
  listLinks,
  markAllLinks,
  markLink,
  markLoadedLinks,
  removeLink,
  saveLink as saveReadingLink,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { LinkRepositoryLive } from '../../src/adapter/link-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { linksSchema } from '../../src/infrastructure/links';

const saveLink = (owner: string, url: string) =>
  saveReadingLink(owner, url).pipe(Effect.map(({ item }) => item));

const changeLink = (owner: string, key: string, read: boolean | undefined) =>
  (read === undefined
    ? removeLink(owner, key)
    : markLink(owner, key, read)
  ).pipe(
    Effect.as(true),
    Effect.catchTag('LinkNotFound', () => Effect.succeed(false))
  );

const verifyReadIsolation = Effect.gen(function* () {
  const first = yield* saveLink('alice', 'https://example.com/');
  expect(first?.read).toBe(false);
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 1 });
  expect(yield* countUnreadLinks('bob')).toEqual({ count: 0 });
  expect(
    (yield* Effect.flip(saveLink('alice', 'https://example.com/')))._tag
  ).toBe('DuplicateLink');
  expect((yield* listLinks('bob', false, 0)).items).toEqual([]);
  expect(yield* changeLink('bob', first?.key ?? '', true)).toBe(false);
  expect(yield* changeLink('bob', first?.key ?? '', undefined)).toBe(false);
  expect(yield* changeLink('alice', first?.key ?? '', true)).toBe(true);
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 0 });
  expect((yield* listLinks('alice', false, 0)).items).toEqual([]);
  expect((yield* listLinks('alice', true, 0)).items[0]?.title).toBe('Example');
  expect(yield* changeLink('alice', first?.key ?? '', false)).toBe(true);
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 1 });
  expect(yield* changeLink('alice', first?.key ?? '', undefined)).toBe(true);
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 0 });
  expect((yield* listLinks('alice', false, 0)).items).toEqual([]);
});

const seedLinks = Effect.gen(function* () {
  for (let index = 0; index < 31; index++) {
    yield* saveLink('alice', `https://example.com/${index}`);
  }
});

const verifyCursorPaging = Effect.gen(function* () {
  const page = yield* listLinks('alice', false, 0);
  expect(page.items).toHaveLength(30);
  expect(page.hasMore).toBe(true);
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 31 });
  const offsetPage = yield* listLinks('alice', false, 30);
  expect(offsetPage.items).toHaveLength(1);
  const last = page.items[29];
  const older = offsetPage.items[0];
  for (const item of page.items.slice(0, 2)) {
    expect(yield* markLink('alice', item.key, true)).toEqual({ ok: true });
  }

  const cursorPage = yield* listLinks(
    'alice',
    false,
    0,
    false,
    last?.createdAt ?? '',
    last?.key ?? ''
  );
  expect(cursorPage.items.map((item) => item.key)).toEqual([older?.key]);
  expect((yield* listLinks('alice', false, 30)).items).toEqual([]);
  const all = yield* listLinks('alice', false, 0, true);
  expect(all.items).toHaveLength(30);
  expect(all.items.filter((item) => item.read)).toHaveLength(2);
  const allCursor = yield* listLinks(
    'alice',
    false,
    0,
    true,
    last?.createdAt ?? '',
    last?.key ?? ''
  );
  expect(allCursor.items.map((item) => item.key)).toEqual([older?.key]);
});

const verifyBulkMark = Effect.gen(function* () {
  yield* saveLink('bob', 'https://bob.example.com/');
  expect(yield* markAllLinks('alice')).toEqual({ ok: true });
  expect(yield* countUnreadLinks('alice')).toEqual({ count: 0 });
  expect(yield* countUnreadLinks('bob')).toEqual({ count: 1 });
  expect(
    (yield* listLinks('alice', false, 0, true)).items.every((item) => item.read)
  ).toBe(true);
  expect(yield* markAllLinks('bob')).toEqual({ ok: true });
  expect(yield* countUnreadLinks('bob')).toEqual({ count: 0 });
});

const verifyLoadedMark = Effect.gen(function* () {
  const first = yield* saveLink('carol', 'https://carol.example.com/1');
  const second = yield* saveLink('carol', 'https://carol.example.com/2');
  const other = yield* saveLink('dave', 'https://dave.example.com/');
  expect(yield* markLoadedLinks('carol', [])).toEqual({ ok: true });
  expect(yield* countUnreadLinks('carol')).toEqual({ count: 2 });
  expect(
    yield* markLoadedLinks('carol', [first?.key ?? '', other?.key ?? ''])
  ).toEqual({ ok: true });
  expect(yield* countUnreadLinks('carol')).toEqual({ count: 1 });
  expect(yield* countUnreadLinks('dave')).toEqual({ count: 1 });
  expect(
    (yield* listLinks('carol', true, 0)).items.map(({ key }) => key)
  ).toEqual([first?.key]);
  expect(
    (yield* listLinks('carol', false, 0)).items.map(({ key }) => key)
  ).toEqual([second?.key]);
});

const verifyReadingLists = Effect.gen(function* () {
  const db = yield* Database;
  yield* Effect.promise(() => db.query(linksSchema));
  yield* verifyLoadedMark;
  yield* verifyReadIsolation;
  yield* seedLinks;
  yield* verifyCursorPaging;
  yield* verifyBulkMark;
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
