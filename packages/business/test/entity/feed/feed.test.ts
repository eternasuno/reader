import { describe, expect, it } from '@effect/vitest';
import { Option, Result, Schema } from 'effect';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';
import { OwnerId } from '../../../src/entity/common/owner-id';
import {
  Feed,
  FeedId,
  FeedTitle,
  makeFeedTitle,
} from '../../../src/entity/feed/feed';
import { Folder, FolderName } from '../../../src/entity/folder/folder';

const alice = OwnerId.make('alice');

const url = Schema.decodeSync(NormalizedUrl)('https://example.com/feed.xml');

const makeFeed = (): Feed =>
  Feed.make({
    ownerId: alice,
    url,
    title: FeedTitle.make('Feed'),
    folderId: Option.none(),
    updatedAt: Option.none(),
  });

describe('FeedTitle', () => {
  it('FD-PARSE-8 trims the title and rejects a blank one', () => {
    const decode = Schema.decodeUnknownResult(FeedTitle);

    expect(Result.getOrThrow(decode('  My feed  '))).toBe('My feed');
    expect(Result.isFailure(decode('   '))).toBe(true);
    expect(Result.isFailure(decode(''))).toBe(true);
  });

  it('FD-PARSE-8 falls back to the host of the address when the title is blank', () => {
    const feedUrl = new URL('https://example.com/feed.xml');

    expect(makeFeedTitle('', feedUrl)).toBe('example.com');
    expect(makeFeedTitle('   ', new URL('http://news.site:8080/x'))).toBe(
      'news.site:8080'
    );
    expect(makeFeedTitle('  My feed ', feedUrl)).toBe('My feed');
  });
});

describe('Feed', () => {
  it('FD-ID-1 makes a lower-case version-7 id when the feed is created', () => {
    const feed = makeFeed();

    expect(Schema.is(FeedId)(feed.id)).toBe(true);
    expect(feed.id).toBe(feed.id.toLowerCase());
  });

  it('FD-SUB builds a feed with no folder and no sync time', () => {
    const feed = makeFeed();

    expect(feed.ownerId).toBe(alice);
    expect(feed.url.href).toBe('https://example.com/feed.xml');
    expect(feed.title).toBe('Feed');
    expect(feed.folderId).toEqual(Option.none());
    expect(feed.updatedAt).toEqual(Option.none());
  });

  it('omits an absent folder and sync time from JSON instead of writing null', () => {
    const encoded = Schema.encodeUnknownSync(Feed)(makeFeed());

    expect(encoded.folderId).toBeUndefined();
    expect(encoded.updatedAt).toBeUndefined();
  });

  it('FD-FOLDER-3 decodes a stored folder id', () => {
    const folderId = Folder.make({
      ownerId: alice,
      name: FolderName.make('Tech'),
    }).id;
    const feed = Schema.decodeSync(Feed)({
      ...Schema.encodeUnknownSync(Feed)(makeFeed()),
      folderId,
    });

    expect(feed.folderId).toEqual(Option.some(folderId));
  });

  it('FD-SYNC records the time of the last successful sync', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const feed = Schema.decodeSync(Feed)({
      ...Schema.encodeUnknownSync(Feed)(makeFeed()),
      updatedAt,
    });

    expect(Option.getOrThrow(feed.updatedAt).epochMilliseconds).toBe(
      updatedAt.getTime()
    );
  });
});

describe('Feed preferences', () => {
  it('FD-PREF-1 starts a new feed with the default reader mode and newest first', () => {
    const feed = makeFeed();

    expect(feed.readerMode).toBe('default');
    expect(feed.order).toBe('newest');
  });

  it('FD-PREF-1 rejects a reader mode or an order outside the literals', () => {
    const encoded = Schema.encodeUnknownSync(Feed)(makeFeed());
    const decode = Schema.decodeUnknownResult(Feed);

    expect(Result.isFailure(decode({ ...encoded, readerMode: 'raw' }))).toBe(
      true
    );
    expect(Result.isFailure(decode({ ...encoded, order: 'random' }))).toBe(
      true
    );
  });
});
