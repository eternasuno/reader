import { expect, it } from '@effect/vitest';
import {
  ArticleDescription,
  ArticleTitle,
  FeedParserError,
  FeedTitle,
  FetchFeedError,
  NormalizedUrl,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  fetchFeedItems,
  listFeeds,
  previewFeed,
  readFailure,
  readFeeds,
  readItemPage,
  readPreview,
  sessionFor,
} from './library-feeds-support';
import { makeHarness } from './library-support';

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const entry = (title: string, path: string) => ({
  title: Schema.decodeSync(ArticleTitle)(title),
  description: Option.none(),
  content: Option.none(),
  url: decodeUrl(`https://example.com/${path}`),
  publishedAt: Option.none(),
});

const parsedFeed = (
  title: string,
  description: Option.Option<ArticleDescription>
) => ({
  title: FeedTitle.make(title),
  description,
  entries: [entry('One', 'one'), entry('Two', 'two')],
});

it.effect('previews a normalized address without storing anything', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        parsedFeed: () =>
          parsedFeed(
            'Example feed',
            Option.some(ArticleDescription.make('Daily updates'))
          ),
      });
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        previewFeed(
          harness,
          alice,
          ' https://example.com/feed.xml?utm_source=news#top '
        )
      );
      const { raw, preview } = yield* Effect.promise(() =>
        readPreview(response)
      );
      const feeds = yield* Effect.promise(() => listFeeds(harness, alice));
      const items = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { limit: 30 })
      );

      expect(response.status).toBe(200);
      expect(raw).toEqual({
        url: 'https://example.com/feed.xml',
        title: 'Example feed',
        description: 'Daily updates',
        titles: ['One', 'Two'],
      });
      expect(preview.titles).toEqual(['One', 'Two']);
      expect(
        (yield* Effect.promise(() => readFeeds(feeds))).page.items
      ).toEqual([]);
      expect((yield* Effect.promise(() => readItemPage(items))).page).toEqual({
        items: [],
        cursor: null,
      });
      expect(harness.enqueued).toEqual([]);
    })
  )
);

it.effect('omits the preview description when the source has none', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        parsedFeed: () => parsedFeed('Example feed', Option.none()),
      });
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        previewFeed(harness, alice, 'https://example.com/feed.xml')
      );
      const { raw, preview } = yield* Effect.promise(() =>
        readPreview(response)
      );

      expect(response.status).toBe(200);
      expect(Object.hasOwn(raw, 'description')).toBe(false);
      expect(Option.isNone(preview.description)).toBe(true);
    })
  )
);

it.effect('rejects an invalid preview address', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        previewFeed(harness, alice, 'ftp://example.com/feed.xml')
      );

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedUrlInvalid',
        message: '请输入有效的订阅地址',
      });
    })
  )
);

it.effect('reports a preview fetch failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        feed: () => Effect.fail(new FetchFeedError({ message: 'offline' })),
      });
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        previewFeed(harness, alice, 'https://example.com/feed.xml')
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FetchFeedError',
        message: '无法获取订阅内容，请稍后重试',
      });
    })
  )
);

it.effect('reports a preview parse failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        parsedFeed: () =>
          Effect.fail(new FeedParserError({ message: 'not a feed' })),
      });
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        previewFeed(harness, alice, 'https://example.com/feed.xml')
      );

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedParserError',
        message: '无法解析订阅源，请确认地址正确',
      });
    })
  )
);
