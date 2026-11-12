import { expect, it } from '@effect/vitest';
import { DateTime, Effect } from 'effect';
import {
  listPages,
  readFailure,
  readItem,
  readPage,
  seedFeedItem,
  sessionFor,
} from './library-saved-pages-support';
import { type Harness, makeHarness } from './library-support';

const articleHtml = `<!doctype html>
<html>
  <head><title>Fetched article</title></head>
  <body>
    <article>
      <h1>Fetched article</h1>
      <p>An example article body long enough for the extractor to keep it as
      the article content of the saved page.</p>
    </article>
  </body>
</html>`;

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2021-05-06T07:08:09.000Z')
);

const saveItem = (harness: Harness, cookie: string, id: string) =>
  harness.call({
    method: 'POST',
    path: '/api/library/saved-pages/from-feed-item',
    cookie,
    body: { id },
  });

it.effect('copies a feed item into an unread page of its own', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const item = yield* seedFeedItem(harness, session.owner, {
        url: 'https://example.com/feed-article',
        title: 'Feed article',
        description: 'Feed summary',
        content: '<p>Feed body</p>',
        publishedAt,
      });
      let fetches = 0;
      harness.stubs.webpage = () => {
        fetches += 1;

        return articleHtml;
      };

      const response = yield* Effect.promise(() =>
        saveItem(harness, session.cookie, item.id)
      );
      const { raw, item: copy } = yield* Effect.promise(() =>
        readItem(response)
      );

      expect(response.status).toBe(201);
      expect(copy.url).toBe('https://example.com/feed-article');
      expect(copy.title).toBe('Feed article');
      expect(copy.content).toBe('<p>Feed body</p>');
      expect(copy.read).toBe(false);
      expect(raw.description).toBe('Feed summary');
      expect(raw.publishedAt).toBe('2021-05-06T07:08:09.000Z');
      expect(fetches).toBe(0);

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items.map((saved) => saved.id)).toEqual([copy.id]);
    })
  )
);

it.effect('uses the extracted content before the feed content', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const item = yield* seedFeedItem(harness, session.owner, {
        content: '<p>Feed body</p>',
        extractedContent: '<p>Extracted body</p>',
      });
      let fetches = 0;
      harness.stubs.webpage = () => {
        fetches += 1;

        return articleHtml;
      };

      const response = yield* Effect.promise(() =>
        saveItem(harness, session.cookie, item.id)
      );
      const { item: copy } = yield* Effect.promise(() => readItem(response));

      expect(response.status).toBe(201);
      expect(copy.content).toBe('<p>Extracted body</p>');
      expect(fetches).toBe(0);
    })
  )
);

it.effect('fetches the article when the feed item has no content', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const item = yield* seedFeedItem(harness, session.owner);
      harness.stubs.webpage = () => articleHtml;

      const response = yield* Effect.promise(() =>
        saveItem(harness, session.cookie, item.id)
      );
      const { item: copy } = yield* Effect.promise(() => readItem(response));

      expect(response.status).toBe(201);
      expect(copy.title).toBe('Feed article');
      expect(copy.content).toContain('example article body');
    })
  )
);

it.effect('reports an unknown or foreign feed item as not found', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const gone = yield* seedFeedItem(harness, alice.owner);
      const theirs = yield* seedFeedItem(harness, bob.owner);
      yield* harness.repositories.feedItem.remove(alice.owner, [gone.id]);

      for (const id of [gone.id, theirs.id]) {
        const response = yield* Effect.promise(() =>
          saveItem(harness, alice.cookie, id)
        );

        expect(response.status).toBe(404);
        expect(yield* Effect.promise(() => readFailure(response))).toEqual({
          _tag: 'FeedItemNotFound',
          message: '文章不存在，可能已被删除',
          id,
        });
      }

      const listed = yield* Effect.promise(() =>
        listPages(harness, alice, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items).toEqual([]);
    })
  )
);

it.effect('reports an already saved feed item with its url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const item = yield* seedFeedItem(harness, session.owner, {
        url: 'https://example.com/feed-article',
        content: '<p>Feed body</p>',
      });
      const created = yield* Effect.promise(() =>
        saveItem(harness, session.cookie, item.id)
      );
      const { item: copy } = yield* Effect.promise(() => readItem(created));
      let fetches = 0;
      harness.stubs.webpage = () => {
        fetches += 1;

        return articleHtml;
      };

      const duplicate = yield* Effect.promise(() =>
        saveItem(harness, session.cookie, item.id)
      );

      expect(duplicate.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(duplicate))).toEqual({
        _tag: 'SavedPageAlreadyExists',
        message: '该文章已在稍后阅读中',
        url: 'https://example.com/feed-article',
      });
      expect(fetches).toBe(0);

      const listed = yield* Effect.promise(() =>
        listPages(harness, session, { limit: 10 })
      );
      const { page } = yield* Effect.promise(() => readPage(listed));

      expect(page.items.map((saved) => saved.id)).toEqual([copy.id]);
    })
  )
);
