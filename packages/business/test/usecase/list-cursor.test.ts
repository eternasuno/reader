import { expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import { FeedId } from '../../src/entity/feed/feed';
import { OwnerId } from '../../src/entity/object-value/owner-id';
import {
  encodeListCursor,
  type ListCursor,
  ListCursorFromString,
} from '../../src/usecase/list-cursor';

const publishedAt = Schema.decodeSync(Schema.DateTimeUtcFromString)(
  '2026-01-01T00:00:00.000Z'
);

const cursor = (overrides: Partial<ListCursor> = {}): ListCursor => ({
  version: 1,
  owner: OwnerId.make('alice'),
  scope: { kind: 'saved' },
  filter: 'all',
  after: { publishedAt, id: 'a'.repeat(64) },
  ...overrides,
});

const encode = Schema.encodeSync(ListCursorFromString);

const decode = Schema.decodeSync(ListCursorFromString);

it('keeps the emitted cursor an opaque base64 JSON payload', () => {
  const wire = encodeListCursor({
    owner: OwnerId.make('alice'),
    scope: { kind: 'saved' },
    filter: 'all',
    publishedAt,
    id: 'a'.repeat(64),
  });

  expect(JSON.parse(atob(wire))).toEqual({
    version: 1,
    owner: 'alice',
    scope: { kind: 'saved' },
    filter: 'all',
    after: { publishedAt: '2026-01-01T00:00:00.000Z', id: 'a'.repeat(64) },
  });

  const feedWire = encodeListCursor({
    owner: OwnerId.make('alice'),
    scope: {
      kind: 'feeds',
      feedId: Option.some(FeedId.make('f'.repeat(64))),
    },
    filter: 'unread',
    publishedAt,
    id: 'a'.repeat(64),
  });

  expect(JSON.parse(atob(feedWire))).toEqual({
    version: 1,
    owner: 'alice',
    scope: { kind: 'feeds', feedId: 'f'.repeat(64) },
    filter: 'unread',
    after: { publishedAt: '2026-01-01T00:00:00.000Z', id: 'a'.repeat(64) },
  });
});

it('round-trips saved and feed-scoped cursors', () => {
  const saved = encode(cursor());
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

  for (const wire of [saved, allFeeds, oneFeed]) {
    expect(encode(decode(wire))).toBe(wire);
  }
});

it('rejects malformed or incomplete opaquely encoded cursors', () => {
  const payload = JSON.parse(atob(encode(cursor())));

  for (const wire of [
    'not-a-cursor',
    btoa('{"version":1}'),
    btoa(JSON.stringify({ ...payload, version: 2 })),
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
