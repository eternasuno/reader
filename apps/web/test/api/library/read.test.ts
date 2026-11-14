import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { Feed, Folder } from '../../../src/api/library';
import {
  feedArticle,
  feedId,
  feedItemJson,
  folderId,
  itemId,
  json,
  makeClient,
  savedArticle,
  savedId,
  savedPageJson,
  uuid,
} from '../../support/api';

const topFeedId = uuid('5');

const feedsJson = [
  {
    id: feedId,
    ownerId: 'owner',
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    updatedAt: '2026-01-01T00:00:00.000Z',
    folderId,
  },
  {
    id: topFeedId,
    ownerId: 'owner',
    url: 'https://example.com/top.xml',
    title: 'Top',
  },
];

const feeds: ReadonlyArray<Feed> = [
  {
    id: feedId,
    ownerId: 'owner',
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    updatedAt: Option.some('2026-01-01T00:00:00.000Z'),
    folderId: Option.some(folderId),
  },
  {
    id: topFeedId,
    ownerId: 'owner',
    url: 'https://example.com/top.xml',
    title: 'Top',
    updatedAt: Option.none(),
    folderId: Option.none(),
  },
];

const folders: ReadonlyArray<Folder> = [
  { id: folderId, ownerId: 'owner', name: 'Reading' },
];

describe('article reads', () => {
  it('converts a saved page into an article', async () => {
    const found = makeClient(json({ item: savedPageJson }));
    const missing = makeClient(json({ item: null }));

    expect(
      await found.client.article({ id: savedId, feedId: undefined })
    ).toEqual(savedArticle);
    expect(
      await missing.client.article({ id: savedId, feedId: undefined })
    ).toBeNull();
  });

  it('converts a feed item into an article', async () => {
    const { client } = makeClient(json({ item: feedItemJson }));

    expect(await client.article({ id: itemId, feedId })).toEqual(feedArticle);
  });
});

describe('feed and folder reads', () => {
  it('converts feeds and folders', async () => {
    const { client } = makeClient((request) =>
      request.path === '/api/library/feeds'
        ? Response.json({ items: feedsJson })
        : Response.json({ items: folders })
    );

    expect(await client.feeds()).toEqual(feeds);
    expect(await client.folders()).toEqual(folders);
  });
});

describe('unread counts', () => {
  it('composes the two unread count responses', async () => {
    const otherFeedId = uuid('6');
    const { client } = makeClient((request) =>
      request.path === '/api/library/feeds/unread'
        ? Response.json({
            feeds: [
              { feedId, count: 2 },
              { feedId: otherFeedId, count: 3 },
            ],
          })
        : Response.json({ count: 4 })
    );

    expect(await client.unreadCounts()).toEqual({
      later: 4,
      feedsTotal: 5,
      feeds: { [feedId]: 2, [otherFeedId]: 3 },
    });
  });
});

describe('list scope dispatch', () => {
  const cases = [
    {
      scope: { kind: 'later' },
      path: '/api/library/saved-pages',
      query: { unreadOnly: 'true', limit: '30' },
      cursor: undefined,
      body: { items: [savedPageJson], cursor: null },
      articles: [savedArticle],
    },
    {
      scope: { kind: 'feeds' },
      path: '/api/library/feeds/items',
      query: { unreadOnly: 'true', limit: '30', cursor: itemId },
      cursor: itemId,
      body: { items: [feedItemJson], cursor: itemId },
      articles: [feedArticle],
    },
    {
      scope: { kind: 'feeds', feedId },
      path: '/api/library/feeds/items/by-feed',
      query: { unreadOnly: 'true', limit: '30', feedId },
      cursor: undefined,
      body: { items: [feedItemJson], cursor: null },
      articles: [feedArticle],
    },
    {
      scope: { kind: 'folder', folderId },
      path: '/api/library/feeds/items/by-folder',
      query: { unreadOnly: 'true', limit: '30', folderId },
      cursor: undefined,
      body: { items: [feedItemJson], cursor: null },
      articles: [feedArticle],
    },
  ] as const;

  it.each(cases)('lists $scope.kind from $path', async (one) => {
    const { client, requests } = makeClient(json(one.body));
    const listed = await client.list(one.scope, true, one.cursor);

    expect(requests[0]?.path).toBe(one.path);
    expect(requests[0]?.query).toEqual(one.query);
    expect(listed).toEqual({ items: one.articles, cursor: one.body.cursor });
  });
});

describe('request defaults', () => {
  it('sends credentialed, uncached reads', async () => {
    const { client, requests } = makeClient(json({ items: [] }));

    await client.feeds();

    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
      method: 'GET',
    });
  });
});
