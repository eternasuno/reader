import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  itemAt,
  listPages,
  readItem,
  readPage,
  readUnreadCount,
  seedFeedItem,
  seedPage,
  seedPages,
  sessionFor,
} from './library-saved-pages-support';
import { type Harness, makeHarness, type TestSession } from './library-support';

const markPage = (
  harness: Harness,
  cookie: string,
  id: string,
  read: boolean
) =>
  harness.call({
    method: 'PATCH',
    path: '/api/library/saved-pages',
    cookie,
    body: { id, read },
  });

const markPages = (
  harness: Harness,
  cookie: string,
  ids: ReadonlyArray<string>
) =>
  harness.call({
    method: 'POST',
    path: '/api/library/saved-pages/mark-read',
    cookie,
    body: { ids },
  });

const markAllPages = (harness: Harness, cookie: string) =>
  harness.call({
    method: 'POST',
    path: '/api/library/saved-pages/mark-all-read',
    cookie,
    body: {},
  });

const unreadIds = async (harness: Harness, session: TestSession) => {
  const response = await listPages(harness, session, {
    limit: 10,
    unreadOnly: true,
  });
  const { page } = await readPage(response);

  return page.items.map((saved) => saved.id);
};

it.effect('marks one page read and unread again', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const page = yield* seedPage(harness, session.owner);
      const readOf = async () => {
        const response = await harness.call({
          path: '/api/library/saved-pages/item',
          query: { id: page.id },
          cookie: session.cookie,
        });
        const { item } = await readItem(response);

        return item.read;
      };

      const marked = yield* Effect.promise(() =>
        markPage(harness, session.cookie, page.id, true)
      );

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => marked.json())).toEqual({ ok: true });
      expect(yield* Effect.promise(readOf)).toBe(true);

      const twice = yield* Effect.promise(() =>
        markPage(harness, session.cookie, page.id, true)
      );

      expect(twice.status).toBe(200);
      expect(yield* Effect.promise(readOf)).toBe(true);

      const unmarked = yield* Effect.promise(() =>
        markPage(harness, session.cookie, page.id, false)
      );

      expect(unmarked.status).toBe(200);
      expect(yield* Effect.promise(readOf)).toBe(false);
    })
  )
);

it.effect('marks a batch read and ignores unknown ids', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 3);
      const gone = yield* seedPage(harness, session.owner);
      yield* harness.repositories.savedPage.remove(session.owner, [gone.id]);

      const response = yield* Effect.promise(() =>
        markPages(harness, session.cookie, [
          itemAt(pages, 0).id,
          itemAt(pages, 1).id,
          gone.id,
        ])
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => unreadIds(harness, session))).toEqual([
        itemAt(pages, 2).id,
      ]);
    })
  )
);

it.effect('rejects a batch of more than five thousand ids', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const page = yield* seedPage(harness, session.owner);
      const ids = Array.from({ length: 5001 }, () => page.id);

      const response = yield* Effect.promise(() =>
        markPages(harness, session.cookie, ids)
      );

      expect(response.status).toBe(400);
    })
  )
);

it.effect('marks all own pages read without touching feed items', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      yield* seedPages(harness, alice.owner, 3);
      const article = yield* seedFeedItem(harness, alice.owner);
      const theirPage = yield* seedPage(harness, bob.owner);

      const response = yield* Effect.promise(() =>
        markAllPages(harness, alice.cookie)
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => unreadIds(harness, alice))).toEqual(
        []
      );
      expect(yield* Effect.promise(() => unreadIds(harness, bob))).toEqual([
        theirPage.id,
      ]);

      const stored = yield* harness.repositories.feedItem.find(
        alice.owner,
        article.id
      );

      expect(Option.getOrThrow(stored).read).toBe(false);
    })
  )
);

it.effect('ignores the pages of another owner when marking', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const page = yield* seedPage(harness, alice.owner);

      const single = yield* Effect.promise(() =>
        markPage(harness, bob.cookie, page.id, true)
      );
      const batch = yield* Effect.promise(() =>
        markPages(harness, bob.cookie, [page.id])
      );

      expect(single.status).toBe(200);
      expect(batch.status).toBe(200);
      expect(yield* Effect.promise(() => unreadIds(harness, alice))).toEqual([
        page.id,
      ]);

      const counted = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/saved-pages/unread',
          cookie: alice.cookie,
        })
      );

      expect(yield* Effect.promise(() => readUnreadCount(counted))).toEqual({
        count: 1,
      });
    })
  )
);
