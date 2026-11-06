import { expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import {
  type ArticleCursor,
  ArticleCursorFromString,
  ArticleId,
  encodeArticleCursor,
} from '../../src/entity/article';
import { FeedId, OwnerId } from '../../src/entity/object-value';

const publishedAt = Schema.decodeSync(Schema.DateTimeUtcFromString)(
  '2026-01-01T00:00:00.000Z'
);

const cursor = (overrides: Partial<ArticleCursor> = {}): ArticleCursor => ({
  version: 1,
  owner: OwnerId.make('alice'),
  scope: { kind: 'later' },
  filter: 'all',
  after: { publishedAt, id: ArticleId.make('a'.repeat(64)) },
  ...overrides,
});

const encode = Schema.encodeSync(ArticleCursorFromString);

const decode = Schema.decodeSync(ArticleCursorFromString);

it('keeps the emitted cursor an opaque base64 JSON payload', () => {
  const wire = encodeArticleCursor({
    owner: OwnerId.make('alice'),
    scope: { kind: 'later' },
    filter: 'all',
    publishedAt: '2026-01-01T00:00:00.000Z',
    id: ArticleId.make('a'.repeat(64)),
  });

  expect(JSON.parse(atob(wire))).toEqual({
    version: 1,
    owner: 'alice',
    scope: { kind: 'later' },
    filter: 'all',
    after: { publishedAt: '2026-01-01T00:00:00.000Z', id: 'a'.repeat(64) },
  });

  const feedWire = encodeArticleCursor({
    owner: OwnerId.make('alice'),
    scope: {
      kind: 'feeds',
      feedId: Option.some(FeedId.make('f'.repeat(64))),
    },
    filter: 'unread',
    publishedAt: '2026-01-01T00:00:00.000Z',
    id: ArticleId.make('a'.repeat(64)),
  });

  expect(JSON.parse(atob(feedWire))).toEqual({
    version: 1,
    owner: 'alice',
    scope: { kind: 'feeds', feedId: 'f'.repeat(64) },
    filter: 'unread',
    after: { publishedAt: '2026-01-01T00:00:00.000Z', id: 'a'.repeat(64) },
  });
});

it('round-trips later and feed-scoped cursors', () => {
  const later = encode(cursor());
  const allFeeds = encode(
    cursor({ scope: { kind: 'feeds', feedId: Option.none() } })
  );
  const oneFeed = encode(
    cursor({
      filter: 'unread',
      scope: {
        kind: 'feeds',
        feedId: Option.some(FeedId.make('f'.repeat(64))),
      },
    })
  );

  for (const wire of [later, allFeeds, oneFeed]) {
    expect(encode(decode(wire))).toBe(wire);
  }
});

it('rejects malformed or incomplete opaquely encoded cursors', () => {
  const payload = JSON.parse(atob(encode(cursor())));

  for (const wire of [
    'not-a-cursor',
    btoa('{"version":1}'),
    btoa(JSON.stringify({ ...payload, version: 2 })),
    btoa(JSON.stringify({ ...payload, owner: '' })),
    btoa(JSON.stringify({ ...payload, filter: 'recent' })),
    btoa(
      JSON.stringify({
        ...payload,
        after: { publishedAt: 'not-a-date', id: 'a'.repeat(64) },
      })
    ),
  ]) {
    expect(() => decode(wire)).toThrow();
  }
});
