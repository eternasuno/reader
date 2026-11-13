import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeRunner } from '../../src/api/client';
import {
  type Article,
  createLibraryClient,
  type Feed,
  type Folder,
  LibraryError,
  type LibraryErrorTag,
  libraryErrorMessages,
} from '../../src/api/library';

const uuid = (suffix: string): string =>
  `019a0000-0000-7000-8000-${suffix.padStart(12, '0')}`;

const savedId = uuid('1');
const itemId = uuid('2');
const feedId = uuid('3');
const folderId = uuid('4');

type Recorded = {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly init: RequestInit | undefined;
};

type Handler = (request: Recorded) => Response | Promise<Response>;

const makeClient = (handler: Handler) => {
  const requests: Array<Recorded> = [];
  const client = createLibraryClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const request: Recorded = {
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        init,
      };
      requests.push(request);

      return handler(request);
    },
  });

  return { client, requests };
};

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

const failure = async (task: Promise<unknown>): Promise<unknown> =>
  task.catch((caught: unknown) => caught);

const savedPageJson = {
  id: savedId,
  ownerId: 'owner',
  url: 'https://example.com/saved',
  title: 'Saved',
  content: '<p>Body</p>',
  read: false,
};

const savedArticle: Article = {
  id: savedId,
  feedId: Option.none(),
  url: Option.some('https://example.com/saved'),
  title: 'Saved',
  description: Option.none(),
  content: Option.some('<p>Body</p>'),
  extractedContent: Option.some('<p>Body</p>'),
  publishedAt: undefined,
  read: false,
};

const feedItemJson = {
  id: itemId,
  ownerId: 'owner',
  feedId,
  url: 'https://example.com/item',
  title: 'Item',
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: true,
};

const feedArticle: Article = {
  id: itemId,
  feedId: Option.some(feedId),
  url: Option.some('https://example.com/item'),
  title: 'Item',
  description: Option.none(),
  content: Option.none(),
  extractedContent: Option.none(),
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: true,
};

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

describe('error wording', () => {
  it('keeps a message for every tag of the table', () => {
    for (const [tag, message] of Object.entries(libraryErrorMessages)) {
      const error = new LibraryError(tag as LibraryErrorTag);

      expect(error.tag).toBe(tag);
      expect(error.message).toBe(message);
    }
  });

  it('keeps the saved page url of a duplicate article', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'SavedPageAlreadyExists',
          message: 'backend text',
          url: 'https://example.com/post',
        },
        409
      )
    );

    expect(await failure(client.add('https://example.com/post'))).toMatchObject(
      {
        tag: 'SavedPageAlreadyExists',
        url: 'https://example.com/post',
        id: undefined,
        message: '该文章已在稍后阅读中',
      }
    );
  });

  it('keeps the item id of a missing article', async () => {
    const { client } = makeClient(
      json({ _tag: 'FeedItemNotFound', message: 'missing', id: itemId }, 404)
    );

    expect(await failure(client.extract(feedArticle))).toMatchObject({
      tag: 'FeedItemNotFound',
      id: itemId,
      message: '文章不存在，可能已被删除',
    });
  });
});

describe('error fallbacks', () => {
  it('maps a rejected fetch to a network failure', async () => {
    const client = createLibraryClient({
      fetch: () => Promise.reject(new Error('offline')),
    });

    expect(await failure(client.feeds())).toMatchObject({
      tag: 'NetworkError',
      message: '网络连接失败，请检查网络后重试',
    });
  });

  it.each([
    ['Unauthorized', 401],
    ['Forbidden', 403],
    ['AuthUnavailable', 500],
  ] as const)('maps a %s response body', async (tag, status) => {
    const { client } = makeClient(json({ _tag: tag }, status));
    const caught = await failure(client.add('https://example.com/post'));

    expect(caught).toMatchObject({ tag, message: libraryErrorMessages[tag] });
  });

  it('keeps the original defect instead of wrapping it', async () => {
    const run = makeRunner({});
    const boom = new Error('boom');

    expect(await failure(run(() => Effect.die(boom)))).toBe(boom);
  });

  it.each([
    ['RequestFailed', () => new Response('boom', { status: 500 })],
    ['InvalidResponse', json({ items: [{ id: feedId }] })],
  ] as const)('maps an unexpected response to %s', async (tag, handler) => {
    const { client } = makeClient(handler);

    expect(await failure(client.feeds())).toMatchObject({
      tag,
      message: libraryErrorMessages[tag],
    });
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
