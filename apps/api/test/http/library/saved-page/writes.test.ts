import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  readFailure,
  readJson,
  readNullableSavedPage,
  readSavedPages,
  readUnreadCount,
  seedPage,
  seedPages,
  sessionFor,
} from '../../../support/fixtures';
import { makeHarness } from '../../../support/harness';

const SAVED_PAGES = '/api/library/saved-pages';
const SAVED_PAGE = '/api/library/saved-pages/item';
const SAVED_PAGE_UNREAD = '/api/library/saved-pages/unread';
const MARK_PAGES = '/api/library/saved-pages/mark-read';
const MARK_ALL_PAGES = '/api/library/saved-pages/mark-all-read';

it.effect('marks one page read and leaves nothing unread', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const page = yield* seedPage(harness, session.owner);

      const marked = yield* call(harness, {
        method: 'PATCH',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { id: page.id, read: true },
      });
      const unread = yield* call(harness, {
        path: SAVED_PAGE_UNREAD,
        cookie: session.cookie,
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readUnreadCount(unread))).toEqual({
        count: 0,
      });
    })
  )
);

it.effect('marks a batch of pages read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 2);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_PAGES,
        cookie: session.cookie,
        body: { ids: pages.map((page) => page.id) },
      });
      const unread = yield* call(harness, {
        path: SAVED_PAGES,
        cookie: session.cookie,
        query: { unreadOnly: true, limit: 10 },
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(
        (yield* Effect.promise(() => readSavedPages(unread))).items
      ).toEqual([]);
    })
  )
);

it.effect('marks all pages read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* seedPages(harness, session.owner, 2);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_ALL_PAGES,
        cookie: session.cookie,
        body: {},
      });
      const unread = yield* call(harness, {
        path: SAVED_PAGE_UNREAD,
        cookie: session.cookie,
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readUnreadCount(unread))).toEqual({
        count: 0,
      });
    })
  )
);

it.effect('removes a page so it can no longer be opened', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const page = yield* seedPage(harness, session.owner);

      const removed = yield* call(harness, {
        method: 'DELETE',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { id: page.id },
      });
      const found = yield* call(harness, {
        path: SAVED_PAGE,
        cookie: session.cookie,
        query: { id: page.id },
      });

      expect(removed.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(removed))).toEqual({
        ok: true,
      });
      expect(found.status).toBe(200);
      expect(
        yield* Effect.promise(() => readNullableSavedPage(found))
      ).toBeNull();
    })
  )
);

it.effect('rejects a url that is not http or https', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'ftp://example.com/post' },
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidPageUrl',
      });
    })
  )
);

it.effect('rejects a duplicate saved page with its url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'https://example.com/post' },
      });

      const duplicate = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'https://example.com/post?utm_campaign=y' },
      });

      expect(duplicate.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(duplicate))).toEqual({
        _tag: 'SavedPageAlreadyExists',
        url: 'https://example.com/post',
      });
    })
  )
);

it.effect('reports a webpage fetch failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      harness.stubs.webpage = () =>
        new Response('unavailable', { status: 503 });

      const response = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'https://example.com/broken' },
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'WebpageFetcherError',
      });
    })
  )
);

it.effect('reports a page without an article', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      harness.stubs.webpage = () => '<!doctype html><html><body></body></html>';

      const response = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'https://example.com/empty' },
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'ArticleExtractorError',
      });
    })
  )
);

it.effect(
  'CM-PAGE-2 rejects a zero, negative or non-integer limit and a malformed cursor',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* sessionFor(harness, 'alice@example.com');
        const statuses = [];
        for (const limit of ['abc', '0', '-1', '1.5']) {
          const response = yield* call(harness, {
            path: SAVED_PAGES,
            cookie: session.cookie,
            query: { limit },
          });
          statuses.push(response.status);
        }
        const badCursor = yield* call(harness, {
          path: SAVED_PAGES,
          cookie: session.cookie,
          query: { limit: 10, cursor: 'not-a-cursor' },
        });
        const smallest = yield* call(harness, {
          path: SAVED_PAGES,
          cookie: session.cookie,
          query: { limit: 1 },
        });

        expect(statuses).toEqual([400, 400, 400, 400]);
        expect(badCursor.status).toBe(400);
        expect(smallest.status).toBe(200);
      })
    )
);
