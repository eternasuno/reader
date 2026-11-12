import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  addPage,
  readItem,
  readNullableItem,
  readUnreadCount,
  seedPage,
  seedPages,
  sessionFor,
} from './library-saved-pages-support';
import { type Harness, makeHarness } from './library-support';

const openPage = (harness: Harness, cookie: string, id: string) =>
  harness.call({
    path: '/api/library/saved-pages/item',
    query: { id },
    cookie,
  });

const findByUrl = (harness: Harness, cookie: string, url: string) =>
  harness.call({
    path: '/api/library/saved-pages/by-url',
    query: { url },
    cookie,
  });

it.effect('returns the own page when opened by id', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const seeded = yield* seedPage(harness, session.owner, {
        url: 'https://example.com/opened?utm_source=x',
        title: 'Opened page',
        description: 'A saved description',
        content: '<p>Opened body</p>',
        read: true,
      });

      const response = yield* Effect.promise(() =>
        openPage(harness, session.cookie, seeded.id)
      );
      const { raw, item } = yield* Effect.promise(() => readItem(response));

      expect(response.status).toBe(200);
      expect(item.id).toBe(seeded.id);
      expect(item.url).toBe('https://example.com/opened');
      expect(item.title).toBe('Opened page');
      expect(item.content).toBe('<p>Opened body</p>');
      expect(item.read).toBe(true);
      expect(raw.description).toBe('A saved description');
    })
  )
);

it.effect('reports a missing or foreign page as null', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const mine = yield* seedPage(harness, alice.owner);
      const gone = yield* seedPage(harness, alice.owner);
      yield* harness.repositories.savedPage.remove(alice.owner, [gone.id]);

      for (const id of [gone.id, mine.id]) {
        const response = yield* Effect.promise(() =>
          openPage(harness, bob.cookie, id)
        );
        const { item } = yield* Effect.promise(() =>
          readNullableItem(response)
        );

        expect(response.status).toBe(200);
        expect(item).toBeNull();
      }

      const own = yield* Effect.promise(() =>
        openPage(harness, alice.cookie, mine.id)
      );
      const { item } = yield* Effect.promise(() => readNullableItem(own));

      expect(item?.id).toBe(mine.id);
    })
  )
);

it.effect('finds the own page by its normalized url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const added = yield* Effect.promise(() =>
        addPage(harness, session, 'https://example.com/post?utm_source=x#top')
      );
      const { item: created } = yield* Effect.promise(() => readItem(added));

      for (const url of [
        'https://example.com/post',
        'https://example.com/post?utm_campaign=y#comments',
      ]) {
        const response = yield* Effect.promise(() =>
          findByUrl(harness, session.cookie, url)
        );
        const { item } = yield* Effect.promise(() =>
          readNullableItem(response)
        );

        expect(response.status).toBe(200);
        expect(item?.id).toBe(created.id);
        expect(item?.url).toBe('https://example.com/post');
      }
    })
  )
);

it.effect('reports foreign, missing and undecodable urls as null', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const theirs = yield* seedPage(harness, bob.owner, {
        url: 'https://example.com/private',
      });

      for (const url of [
        theirs.url.href,
        'https://example.com/missing',
        'not a url',
        'ftp://example.com/missing',
      ]) {
        const response = yield* Effect.promise(() =>
          findByUrl(harness, alice.cookie, url)
        );
        const { item } = yield* Effect.promise(() =>
          readNullableItem(response)
        );

        expect(response.status).toBe(200);
        expect(item).toBeNull();
      }
    })
  )
);

it.effect('counts only the unread pages of the signed-in owner', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      yield* seedPages(harness, alice.owner, 3);
      yield* seedPage(harness, alice.owner, { read: true });
      yield* seedPages(harness, bob.owner, 1);
      yield* seedPage(harness, bob.owner, { read: true });
      const countFor = async (cookie: string) => {
        const response = await harness.call({
          path: '/api/library/saved-pages/unread',
          cookie,
        });

        expect(response.status).toBe(200);

        return readUnreadCount(response);
      };

      expect(yield* Effect.promise(() => countFor(alice.cookie))).toEqual({
        count: 3,
      });
      expect(yield* Effect.promise(() => countFor(bob.cookie))).toEqual({
        count: 1,
      });

      const marked = yield* Effect.promise(() =>
        harness.call({
          method: 'POST',
          path: '/api/library/saved-pages/mark-all-read',
          cookie: alice.cookie,
          body: {},
        })
      );

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => countFor(alice.cookie))).toEqual({
        count: 0,
      });
      expect(yield* Effect.promise(() => countFor(bob.cookie))).toEqual({
        count: 1,
      });
    })
  )
);
