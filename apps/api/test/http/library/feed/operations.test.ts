import { expect, it } from '@effect/vitest';
import {
  ArticleDescription,
  ArticleTitle,
  FeedTitle,
  NormalizedUrl,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  call,
  readFeed,
  readFeeds,
  readJson,
  readPreview,
  readUnreadFeeds,
  seedFeed,
  seedItem,
  sessionFor,
} from '../../../support/fixtures';
import { makeHarness } from '../../../support/harness';

const FEEDS = '/api/library/feeds';
const PREVIEW = '/api/library/feeds/preview';
const FEEDS_UNREAD = '/api/library/feeds/unread';
const MARK_FEEDS = '/api/library/feeds/mark-read';
const MARK_ALL_ITEMS = '/api/library/feeds/mark-all-read';

const entry = (title: string, path: string) => ({
  title: ArticleTitle.make(title),
  description: Option.none(),
  content: Option.none(),
  url: Schema.decodeSync(NormalizedUrl)(`https://example.com/${path}`),
  publishedAt: Option.none(),
});

const parsedFeed = {
  title: FeedTitle.make('Example feed'),
  description: Option.some(ArticleDescription.make('Daily updates')),
  entries: [entry('One', 'one'), entry('Two', 'two')],
};

it.effect('lists the feeds of the signed-in owner', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const alpha = yield* seedFeed(harness, session.owner, { title: 'Alpha' });
      const beta = yield* seedFeed(harness, session.owner, { title: 'Beta' });

      const response = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });
      const feeds = yield* Effect.promise(() => readFeeds(response));

      expect(response.status).toBe(200);
      expect(feeds.map((feed) => feed.id).sort()).toEqual(
        [alpha.id, beta.id].sort()
      );
      expect(feeds.map((feed) => feed.title).sort()).toEqual(['Alpha', 'Beta']);
      expect(feeds.every((feed) => Option.isNone(feed.updatedAt))).toBe(true);
    })
  )
);

it.effect('previews a feed without storing it', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ parsedFeed: () => parsedFeed });
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: PREVIEW,
        cookie: session.cookie,
        body: { url: ' https://example.com/feed.xml?utm_source=news#top ' },
      });
      const preview = yield* Effect.promise(() => readPreview(response));
      const stored = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });

      expect(response.status).toBe(200);
      expect(preview.url).toBe('https://example.com/feed.xml');
      expect(preview.title).toBe('Example feed');
      expect(preview.description).toBe('Daily updates');
      expect(preview.titles).toEqual(['One', 'Two']);
      expect(yield* Effect.promise(() => readFeeds(stored))).toEqual([]);
    })
  )
);

it.effect('FD-SUB FD-SCHED-7 subscribes and queues one refresh', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FEEDS,
        cookie: session.cookie,
        body: {
          url: ' https://example.com/feed.xml?utm_source=news#top ',
          title: 'My feed',
        },
      });
      const feed = yield* Effect.promise(() => readFeed(response));

      expect(response.status).toBe(201);
      expect(feed.url.href).toBe('https://example.com/feed.xml');
      expect(feed.title).toBe('My feed');
      expect(harness.enqueued).toEqual([
        { owner: session.owner, feedId: feed.id },
      ]);
    })
  )
);

it.effect('unsubscribes from a feed', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);

      const removed = yield* call(harness, {
        method: 'DELETE',
        path: FEEDS,
        cookie: session.cookie,
        body: { id: feed.id },
      });
      const stored = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });

      expect(removed.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(removed))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readFeeds(stored))).toEqual([]);
    })
  )
);

it.effect('counts unread feed items per feed', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      yield* seedItem(harness, session.owner, feed.id);
      yield* seedItem(harness, session.owner, feed.id);
      yield* seedItem(harness, session.owner, feed.id, { read: true });

      const response = yield* call(harness, {
        path: FEEDS_UNREAD,
        cookie: session.cookie,
      });

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readUnreadFeeds(response))).toEqual({
        feeds: [{ feedId: feed.id, count: 2 }],
      });
    })
  )
);

it.effect('marks the items of the given feeds read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const first = yield* seedFeed(harness, session.owner);
      const second = yield* seedFeed(harness, session.owner);
      yield* seedItem(harness, session.owner, first.id);
      yield* seedItem(harness, session.owner, second.id);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_FEEDS,
        cookie: session.cookie,
        body: { feedIds: [first.id] },
      });
      const unread = yield* call(harness, {
        path: FEEDS_UNREAD,
        cookie: session.cookie,
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readUnreadFeeds(unread))).toEqual({
        feeds: [{ feedId: second.id, count: 1 }],
      });
    })
  )
);

it.effect('marks all feed items read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      yield* seedItem(harness, session.owner, feed.id);
      yield* seedItem(harness, session.owner, feed.id);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_ALL_ITEMS,
        cookie: session.cookie,
        body: {},
      });
      const unread = yield* call(harness, {
        path: FEEDS_UNREAD,
        cookie: session.cookie,
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readUnreadFeeds(unread))).toEqual({
        feeds: [],
      });
    })
  )
);
