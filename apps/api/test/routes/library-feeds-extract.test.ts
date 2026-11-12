import { expect, it } from '@effect/vitest';
import { ArticleTitle } from '@reader/business';
import { Effect, Option } from 'effect';
import {
  extractFeedItem,
  fetchFeedItem,
  readExtractedItem,
  readFailure,
  readItem,
  seedFeed,
  seedItem,
  sessionFor,
} from './library-feeds-support';
import { makeHarness } from './library-support';

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const ARTICLE_HTML = `<!doctype html>
<html>
  <head><title>Example article</title></head>
  <body>
    <article>
      <h1>Example article</h1>
      <p>An example article body long enough for the extractor to keep it as
      the article content of the extracted feed item.</p>
    </article>
  </body>
</html>`;

it.effect('extracts an item once and reuses the stored content', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);
      let fetches = 0;
      harness.stubs.webpage = () => {
        fetches += 1;

        return ARTICLE_HTML;
      };

      const first = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, item.id)
      );
      const { raw, item: extracted } = yield* Effect.promise(() =>
        readExtractedItem(first)
      );
      const stored = yield* Effect.promise(async () =>
        readItem(await fetchFeedItem(harness, alice, item.id))
      );
      const second = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, item.id)
      );

      expect(first.status).toBe(200);
      expect(String(raw.extractedContent)).toContain('example article body');
      expect(extracted.id).toBe(item.id);
      expect(extracted.read).toBe(false);
      expect(stored.raw?.extractedContent).toBe(raw.extractedContent);
      expect(second.status).toBe(200);
      expect(fetches).toBe(1);
    })
  )
);

it.effect('reports a missing or foreign item without storing anything', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const theirItem = yield* seedItem(harness, bob.owner, theirs.id);

      const missing = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, unknownId)
      );
      const foreign = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, theirItem.id)
      );
      const stored = yield* Effect.promise(() =>
        fetchFeedItem(harness, bob, theirItem.id)
      );

      expect(missing.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(missing))).toEqual({
        _tag: 'FeedItemNotFound',
        message: '文章不存在，可能已被删除',
        id: unknownId,
      });
      expect(foreign.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(foreign))).toEqual({
        _tag: 'FeedItemNotFound',
        message: '文章不存在，可能已被删除',
        id: theirItem.id,
      });
      expect(
        Object.hasOwn(
          (yield* Effect.promise(() => readItem(stored))).raw ?? {},
          'extractedContent'
        )
      ).toBe(false);
    })
  )
);

it.effect('reports a webpage fetch failure and stores nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);
      harness.stubs.webpage = () => new Response('', { status: 500 });

      const response = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, item.id)
      );
      const stored = yield* Effect.promise(async () =>
        readItem(await fetchFeedItem(harness, alice, item.id))
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'WebpageFetcherError',
        message: '网页抓取失败，请稍后重试',
      });
      expect(Object.hasOwn(stored.raw ?? {}, 'extractedContent')).toBe(false);
    })
  )
);

it.effect('reports empty extracted content and stores nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        articleExtractor: {
          extract: () =>
            Effect.succeed({
              title: ArticleTitle.make('Empty article'),
              description: Option.none(),
              content: Option.none(),
              publishedAt: Option.none(),
            }),
        },
      });
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);

      const response = yield* Effect.promise(() =>
        extractFeedItem(harness, alice, item.id)
      );
      const stored = yield* Effect.promise(async () =>
        readItem(await fetchFeedItem(harness, alice, item.id))
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'ArticleEmptyContent',
        message: '未能提取到文章内容',
      });
      expect(Object.hasOwn(stored.raw ?? {}, 'extractedContent')).toBe(false);
    })
  )
);
