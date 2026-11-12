import { expect, it } from '@effect/vitest';
import { SavedPageRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  addPage,
  itemAt,
  listPages,
  readFailure,
  readItem,
  readPage,
  readUnreadCount,
  seedPage,
  sessionFor,
} from './library-saved-pages-support';
import { type CallOptions, type Harness, makeHarness } from './library-support';

const removePage = (harness: Harness, cookie: string, id: string) =>
  harness.call({
    method: 'DELETE',
    path: '/api/library/saved-pages',
    cookie,
    body: { id },
  });

const authOf = (cookie?: string): Pick<CallOptions, 'cookie'> =>
  cookie === undefined ? {} : { cookie };

const readCalls = (cookie?: string): ReadonlyArray<CallOptions> => {
  const auth = authOf(cookie);

  return [
    { ...auth, path: '/api/library/saved-pages', query: { limit: 10 } },
    { ...auth, path: '/api/library/saved-pages/item', query: { id: 'x' } },
    {
      ...auth,
      path: '/api/library/saved-pages/by-url',
      query: { url: 'https://example.com/missing' },
    },
    { ...auth, path: '/api/library/saved-pages/unread' },
  ];
};

const writeCalls = (cookie?: string): ReadonlyArray<CallOptions> => {
  const auth = authOf(cookie);

  return [
    {
      ...auth,
      method: 'POST',
      path: '/api/library/saved-pages',
      body: { url: 'https://example.com/post' },
    },
    {
      ...auth,
      method: 'POST',
      path: '/api/library/saved-pages/from-feed-item',
      body: { id: 'x' },
    },
    {
      ...auth,
      method: 'PATCH',
      path: '/api/library/saved-pages',
      body: { id: 'x', read: true },
    },
    {
      ...auth,
      method: 'POST',
      path: '/api/library/saved-pages/mark-read',
      body: { ids: [] },
    },
    {
      ...auth,
      method: 'POST',
      path: '/api/library/saved-pages/mark-all-read',
      body: {},
    },
    {
      ...auth,
      method: 'DELETE',
      path: '/api/library/saved-pages',
      body: { id: 'x' },
    },
  ];
};

it.effect('removes a page idempotently', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const page = yield* seedPage(harness, session.owner);
      const gone = yield* seedPage(harness, session.owner);
      yield* harness.repositories.savedPage.remove(session.owner, [gone.id]);

      const removed = yield* Effect.promise(() =>
        removePage(harness, session.cookie, page.id)
      );

      expect(removed.status).toBe(200);
      expect(yield* Effect.promise(() => removed.json())).toEqual({ ok: true });

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page: list } = yield* Effect.promise(() => readPage(listed));

      expect(list.items).toEqual([]);

      const counted = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/saved-pages/unread',
          cookie: session.cookie,
        })
      );

      expect(yield* Effect.promise(() => readUnreadCount(counted))).toEqual({
        count: 0,
      });

      for (const id of [page.id, page.id, gone.id]) {
        const again = yield* Effect.promise(() =>
          removePage(harness, session.cookie, id)
        );

        expect(again.status).toBe(200);
      }
    })
  )
);

it.effect('saves the same url again as a new page on top', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const first = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/post')
      );
      const { item: removed } = yield* Effect.promise(() => readItem(first));
      const other = yield* seedPage(harness, session.owner);
      yield* Effect.promise(() =>
        removePage(harness, session.cookie, removed.id)
      );

      const added = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/post')
      );
      const { item: again } = yield* Effect.promise(() => readItem(added));

      expect(added.status).toBe(201);
      expect(again.id).not.toBe(removed.id);
      expect(again.read).toBe(false);

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items.map((saved) => saved.id)).toEqual([again.id, other.id]);
    })
  )
);

it.effect('keeps the page of another owner when removing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const page = yield* seedPage(harness, alice.owner);

      const removed = yield* Effect.promise(() =>
        removePage(harness, bob.cookie, page.id)
      );

      expect(removed.status).toBe(200);

      const listed = yield* Effect.promise(() =>
        listPages(harness, alice, { limit: 10 })
      );
      const { page: list } = yield* Effect.promise(() => readPage(listed));

      expect(list.items.map((saved) => saved.id)).toEqual([page.id]);
    })
  )
);

it.effect('requires a session for every saved page endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      for (const request of [...readCalls(), ...writeCalls()]) {
        const response = yield* Effect.promise(() => harness.call(request));

        expect(response.status).toBe(401);
      }
    })
  )
);

it.effect('rejects cross-site modifications but serves reads', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      for (const request of writeCalls(session.cookie)) {
        const response = yield* Effect.promise(() =>
          harness.call({ ...request, origin: 'https://untrusted.example' })
        );

        expect(response.status).toBe(403);
      }

      const read = yield* Effect.promise(() =>
        harness.call({
          ...itemAt(readCalls(session.cookie), 0),
          origin: 'https://untrusted.example',
        })
      );

      expect(read.status).toBe(200);
    })
  )
);

it.effect('reports a saved page repository failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      Object.assign(harness.repositories.savedPage, {
        list: () =>
          Effect.fail(
            new SavedPageRepositoryError({ message: 'Failed to list' })
          ),
      });

      const response = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'SavedPageRepositoryError',
        message: '暂时无法访问稍后阅读，请稍后重试',
      });
    })
  )
);
