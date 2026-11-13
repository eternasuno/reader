import { expect, it } from '@effect/vitest';
import { FeedParserError, FetchFeedError } from '@reader/business';
import { Effect } from 'effect';
import { call, readFailure, sessionFor } from '../../../support/fixtures';
import { makeHarness } from '../../../support/harness';

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
      });
    })
  )
);
