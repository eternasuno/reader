import { describe, expect, it } from '@effect/vitest';
import { Option, Result, Schema } from 'effect';
import {
  Feed,
  FeedId,
  FeedTitle,
  makeFeedTitle,
} from '../../../src/entity/feed/feed';
import { FeedItem } from '../../../src/entity/feed/feed-item';
import { makeFeed, makeFeedItem, makeFolder } from '../../support/fixtures';

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

describe('Feed', () => {
  it('FD-ID-1 makes a new lower-case version-7 id at construction and a later one sorts after it', () => {
    let previous = makeFeed();

    expect(Schema.is(FeedId)(previous.id)).toBe(true);
    expect(previous.id).toBe(previous.id.toLowerCase());

    for (let sample = 0; sample < 7; sample++) {
      const next = makeFeed();

      expect(next.id > previous.id).toBe(true);
      previous = next;
    }
  });

  it('round trips without an updated time', () => {
    const feed = makeFeed();

    expect(Option.isNone(feed.updatedAt)).toBe(true);

    const encoded = Schema.encodeSync(Feed)(feed);

    expect(encoded.updatedAt).toBeUndefined();
    expect(encoded.folderId).toBeUndefined();

    const decoded = Schema.decodeSync(Feed)(encoded);

    expect(decoded.id).toBe(feed.id);
    expect(Option.isNone(decoded.updatedAt)).toBe(true);
    expect(Option.isNone(decoded.folderId)).toBe(true);
  });

  it('decodes a stored folder id', () => {
    const folderId = makeFolder().id;
    const encoded = {
      ...Schema.encodeSync(Feed)(makeFeed()),
      folderId,
    };
    const feed = Schema.decodeSync(Feed)(encoded);

    expect(Option.getOrThrow(feed.folderId)).toBe(folderId);
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
});
