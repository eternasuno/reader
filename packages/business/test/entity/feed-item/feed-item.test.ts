import { describe, expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import { ArticleTitle } from '../../../src/entity/common/article';
import { NormalizedUrl } from '../../../src/entity/common/normalized-url';
import { OwnerId } from '../../../src/entity/common/owner-id';
import { Feed, FeedTitle } from '../../../src/entity/feed/feed';
import { FeedItem, FeedItemId } from '../../../src/entity/feed-item/feed-item';

const alice = OwnerId.make('alice');

const url = Schema.decodeSync(NormalizedUrl)('https://example.com/post');

const feedId = Feed.make({
  ownerId: alice,
  url,
  title: FeedTitle.make('Feed'),
  folderId: Option.none(),
  updatedAt: Option.none(),
}).id;

const makeFeedItem = (): FeedItem =>
  FeedItem.make({
    ownerId: alice,
    feedId,
    url,
    title: ArticleTitle.make('Post'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
  });

describe('FeedItem', () => {
  it('FD-ID-2 makes a lower-case version-7 id when the item is imported', () => {
    const item = makeFeedItem();

    expect(Schema.is(FeedItemId)(item.id)).toBe(true);
    expect(item.id).toBe(item.id.toLowerCase());
  });

  it('FD-IMPORT-1 starts an imported item unread and without extracted content', () => {
    const item = makeFeedItem();

    expect(item.read).toBe(false);
    expect(item.extractedContent).toEqual(Option.none());
    expect(item.ownerId).toBe(alice);
    expect(item.feedId).toBe(feedId);
  });

  it('FD-IMPORT-3 keeps an absent description, content and publish time as none', () => {
    const item = makeFeedItem();

    expect(item.description).toEqual(Option.none());
    expect(item.content).toEqual(Option.none());
    expect(item.publishedAt).toEqual(Option.none());
  });

  it('CM-ART-4 stores the sanitized description and content the cleaner produced', () => {
    const item = Schema.decodeSync(FeedItem)({
      ...Schema.encodeUnknownSync(FeedItem)(makeFeedItem()),
      description: ' <p>about</p> ',
      content: ' <p>body</p> ',
      extractedContent: ' <p>extracted</p> ',
    });

    expect(item.description).toEqual(Option.some('<p>about</p>'));
    expect(item.content).toEqual(Option.some('<p>body</p>'));
    expect(item.extractedContent).toEqual(Option.some('<p>extracted</p>'));
  });

  it('omits an absent description, content and publish time from JSON instead of writing null', () => {
    const encoded = Schema.encodeUnknownSync(FeedItem)(makeFeedItem());

    expect(encoded.description).toBeUndefined();
    expect(encoded.content).toBeUndefined();
    expect(encoded.extractedContent).toBeUndefined();
    expect(encoded.publishedAt).toBeUndefined();
  });

  it('CM-ART-3 turns a stored blank description into none', () => {
    const item = Schema.decodeSync(FeedItem)({
      ...Schema.encodeUnknownSync(FeedItem)(makeFeedItem()),
      description: '   ',
    });

    expect(Option.isNone(item.description)).toBe(true);
  });
});
