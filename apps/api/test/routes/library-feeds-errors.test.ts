import { expect, it } from '@effect/vitest';
import {
  FeedParserError,
  FeedRepositoryError,
  FetchFeedError,
} from '@reader/business';
import { Effect } from 'effect';
import { call, readFailure, seedFeed, sessionFor } from './library-fixtures';
import { makeHarness } from './library-support';

const FEEDS = '/api/library/feeds';
const PREVIEW = '/api/library/feeds/preview';

it.effect('rejects an invalid feed address', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: PREVIEW,
        cookie: session.cookie,
        body: { url: 'ftp://example.com/feed.xml' },
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedUrlInvalid',
        message: '请输入有效的订阅地址',
      });
    })
  )
);

it.effect('rejects a duplicate subscription with its url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* call(harness, {
        method: 'POST',
        path: FEEDS,
        cookie: session.cookie,
        body: { url: 'https://example.com/feed.xml' },
      });

      const duplicate = yield* call(harness, {
        method: 'POST',
        path: FEEDS,
        cookie: session.cookie,
        body: { url: 'https://example.com/feed.xml?utm_source=x#top' },
      });

      expect(duplicate.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(duplicate))).toEqual({
        _tag: 'FeedAlreadyExists',
        message: '该订阅已存在',
        url: 'https://example.com/feed.xml',
      });
    })
  )
);

it.effect('reports a feed fetch failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        feed: () => Effect.fail(new FetchFeedError({ message: 'offline' })),
      });
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: PREVIEW,
        cookie: session.cookie,
        body: { url: 'https://example.com/feed.xml' },
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FetchFeedError',
        message: '无法获取订阅内容，请稍后重试',
      });
    })
  )
);

it.effect('reports a feed parse failure', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        parsedFeed: () =>
          Effect.fail(new FeedParserError({ message: 'not a feed' })),
      });
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: PREVIEW,
        cookie: session.cookie,
        body: { url: 'https://example.com/feed.xml' },
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedParserError',
        message: '无法解析订阅源，请确认地址正确',
      });
    })
  )
);

it.effect('maps a feed repository failure to a server error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* seedFeed(harness, session.owner);
      Object.assign(harness.repositories.feed, {
        list: () => Effect.fail(new FeedRepositoryError({ message: 'down' })),
      });

      const response = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedRepositoryError',
        message: '暂时无法访问订阅，请稍后重试',
      });
    })
  )
);
