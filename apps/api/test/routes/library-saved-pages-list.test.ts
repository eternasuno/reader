import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  itemAt,
  listPages,
  readPage,
  seedPages,
  sessionFor,
} from './library-saved-pages-support';
import { type CallOptions, makeHarness } from './library-support';

const cursorOf = (page: { readonly cursor: string | null }): string => {
  if (page.cursor === null) {
    throw new Error('Expected a page cursor');
  }

  return page.cursor;
};

const idsOf = (page: {
  readonly items: ReadonlyArray<{ readonly id: string }>;
}) => page.items.map((item) => item.id);

it.effect('rejects missing, out-of-range and non-integer limits', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      for (const query of [
        { limit: 0 },
        { limit: 101 },
        { limit: 'abc' },
        { limit: 1.5 },
        {},
      ]) {
        const response = yield* Effect.promise(() =>
          listPages(harness, session, query)
        );

        expect(response.status).toBe(400);
      }
    })
  )
);

it.effect('accepts the limit boundaries of one and one hundred', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* seedPages(harness, session.owner, 2);

      const boundary = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 1 })
      );
      const { page } = yield* Effect.promise(() => readPage(boundary));

      expect(boundary.status).toBe(200);
      expect(page.items).toHaveLength(1);
      expect(page.cursor).not.toBeNull();

      const full = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 100 })
      );
      const { page: whole } = yield* Effect.promise(() => readPage(full));

      expect(whole.items).toHaveLength(2);
      expect(whole.cursor).toBeNull();
    })
  )
);

it.effect('pages newest first without repeating or skipping pages', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 5);
      const expected = pages.map((page) => page.id).toReversed();
      const seen: Array<string> = [];

      const first = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 2 })
      );
      const { page: firstPage } = yield* Effect.promise(() => readPage(first));

      expect(idsOf(firstPage)).toEqual(expected.slice(0, 2));
      seen.push(...idsOf(firstPage));

      const second = yield* Effect.promise(() =>
        listPages(harness, session, {
          limit: 2,
          cursor: cursorOf(firstPage),
        })
      );
      const { page: secondPage } = yield* Effect.promise(() =>
        readPage(second)
      );

      expect(idsOf(secondPage)).toEqual(expected.slice(2, 4));
      seen.push(...idsOf(secondPage));

      const last = yield* Effect.promise(() =>
        listPages(harness, session, {
          limit: 2,
          cursor: cursorOf(secondPage),
        })
      );
      const { page: lastPage } = yield* Effect.promise(() => readPage(last));

      expect(idsOf(lastPage)).toEqual(expected.slice(4));
      expect(lastPage.cursor).toBeNull();
      seen.push(...idsOf(lastPage));

      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(5);
    })
  )
);

it.effect('returns a null cursor for an exactly full page', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 3);

      const response = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 3 })
      );
      const { page } = yield* Effect.promise(() => readPage(response));

      expect(idsOf(page)).toEqual(pages.map((saved) => saved.id).toReversed());
      expect(page.cursor).toBeNull();
    })
  )
);

it.effect('filters by unread pages and lists every page otherwise', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 3);
      const read = itemAt(pages, 1);
      yield* harness.repositories.savedPage.update(session.owner, [read.id], {
        read: true,
      });
      const idsWith = async (query: NonNullable<CallOptions['query']>) => {
        const response = await listPages(harness, session, {
          limit: 10,
          ...query,
        });
        const { page } = await readPage(response);

        return idsOf(page);
      };

      expect(
        yield* Effect.promise(() => idsWith({ unreadOnly: true }))
      ).toEqual([itemAt(pages, 2).id, itemAt(pages, 0).id]);
      expect(
        yield* Effect.promise(() => idsWith({ unreadOnly: false }))
      ).toEqual(pages.map((saved) => saved.id).toReversed());
      expect(yield* Effect.promise(() => idsWith({}))).toEqual(
        pages.map((saved) => saved.id).toReversed()
      );
    })
  )
);

it.effect('rejects a malformed or upper-case cursor', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 1);
      const cursor = itemAt(pages, 0).id;

      for (const value of ['not-a-cursor', cursor.toUpperCase()]) {
        const response = yield* Effect.promise(() =>
          listPages(harness, session, { limit: 10, cursor: value })
        );

        expect(response.status).toBe(400);
      }
    })
  )
);

it.effect('lists only the pages of the signed-in owner', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const mine = yield* seedPages(harness, alice.owner, 2);
      const theirs = yield* seedPages(harness, bob.owner, 1);

      const listed = yield* Effect.promise(() =>
        listPages(harness, alice, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(idsOf(page)).toEqual(mine.map((saved) => saved.id).toReversed());
      expect(idsOf(page)).not.toContain(itemAt(theirs, 0).id);
    })
  )
);
