import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import {
  Feed,
  FeedId,
  FeedTitle,
  makeFeedTitle,
} from '../../../src/entity/feed/feed';
import { FeedItem } from '../../../src/entity/feed/feed-item';
import { alice, decodeUrl, makeFeed, makeFeedItem } from '../../support';

const lowerCaseUuidV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const feedInput = {
  ownerId: alice,
  url: decodeUrl('https://example.com/feed.xml'),
  title: FeedTitle.make('Feed'),
  updatedAt: Option.none(),
};

const makeId = Feed.makeEffect(feedInput).pipe(
  Effect.map((feed) => feed.id),
  Effect.orDie
);

const isStrictlyIncreasing = (ids: ReadonlyArray<string>): boolean =>
  ids.every((id, index) => index === 0 || id > (ids[index - 1] ?? ''));

const withoutKey = (row: object, key: string): object =>
  Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));

describe('FeedTitle', () => {
  it('trims the title and rejects a blank one', () => {
    const decode = Schema.decodeUnknownResult(FeedTitle);

    expect(Result.getOrThrow(decode('  My feed  '))).toBe('My feed');
    expect(Result.isFailure(decode('   '))).toBe(true);
    expect(Result.isFailure(decode(''))).toBe(true);
  });

  it('falls back to the url host of a blank title', () => {
    const url = new URL('https://example.com/feed.xml');

    expect(makeFeedTitle('', url)).toBe('example.com');
    expect(makeFeedTitle('   ', new URL('http://news.site:8080/x'))).toBe(
      'news.site:8080'
    );
    expect(makeFeedTitle('  My feed ', url)).toBe('My feed');
  });
});

describe('FeedId', () => {
  it('rejects ids that are not lower-case version 7 uuids', () => {
    const decode = Schema.decodeUnknownResult(FeedId);

    expect(
      Result.isSuccess(decode('0190a5f0-7c4d-7b3a-8f2e-1a2b3c4d5e6f'))
    ).toBe(true);
    expect(
      Result.isFailure(decode('0190A5F0-7C4D-7B3A-8F2E-1A2B3C4D5E6F'))
    ).toBe(true);
    expect(
      Result.isFailure(decode('f16739e9-6f1e-4e3a-9b0a-2b3c4d5e6f70'))
    ).toBe(true);
    expect(Result.isFailure(decode('not-an-id'))).toBe(true);
  });

  it.effect('makes lower-case version 7 uuids that increase', () =>
    Effect.gen(function* () {
      const ids: Array<string> = [];

      for (let index = 0; index < 200; index += 1) {
        ids.push(yield* makeId);
      }

      for (const id of ids) {
        expect(id).toMatch(lowerCaseUuidV7);
      }

      expect(new Set(ids).size).toBe(ids.length);
      expect(isStrictlyIncreasing(ids)).toBe(true);
    })
  );

  it.effect('keeps increasing under a test clock', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 0, 1));
      const first = yield* makeId;

      yield* TestClock.setTime(Date.UTC(2020, 0, 1));
      const second = yield* makeId;

      expect(first).toMatch(lowerCaseUuidV7);
      expect(second).toMatch(lowerCaseUuidV7);
      expect(second > first).toBe(true);
    })
  );
});

describe('Feed', () => {
  it('round trips without an updated time', () => {
    const feed = makeFeed();

    expect(Option.isNone(feed.updatedAt)).toBe(true);

    const encoded = Schema.encodeSync(Feed)(feed);

    expect(encoded.updatedAt).toBeUndefined();

    const decoded = Schema.decodeSync(Feed)(encoded);

    expect(decoded.id).toBe(feed.id);
    expect(Option.isNone(decoded.updatedAt)).toBe(true);
  });

  it('decodes a stored updated time', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const encoded = {
      ...Schema.encodeSync(Feed)(makeFeed()),
      updatedAt,
    };
    const feed = Schema.decodeSync(Feed)(encoded);

    expect(Option.getOrThrow(feed.updatedAt).epochMilliseconds).toBe(
      updatedAt.getTime()
    );
  });
});

describe('FeedItem', () => {
  it('round trips every optional field as none', () => {
    const item = makeFeedItem();
    const encoded = Schema.encodeSync(FeedItem)(item);

    expect(encoded.description).toBeUndefined();
    expect(encoded.content).toBeUndefined();
    expect(encoded.extractedContent).toBeUndefined();
    expect(encoded.publishedAt).toBeUndefined();

    const decoded = Schema.decodeSync(FeedItem)(encoded);

    expect(decoded.id).toBe(item.id);
    expect(Option.isNone(decoded.description)).toBe(true);
    expect(Option.isNone(decoded.content)).toBe(true);
    expect(Option.isNone(decoded.extractedContent)).toBe(true);
    expect(Option.isNone(decoded.publishedAt)).toBe(true);
  });

  it('requires an owner, a feed, a url and a title', () => {
    const decode = Schema.decodeUnknownResult(FeedItem);
    const item = Schema.encodeSync(FeedItem)(makeFeedItem());

    for (const key of ['ownerId', 'feedId', 'url', 'title']) {
      expect(Result.isFailure(decode(withoutKey(item, key)))).toBe(true);
    }
  });
});
