// biome-ignore-all lint/style/noExcessiveLinesPerFile: the transport test covers every endpoint and error mapping in one client boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped endpoint cases stay together with their shared request fixture.
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type Article,
  createLibraryClient,
  type Feed,
  FeedItemSchema,
  LibraryError,
  type Preview,
  PreviewSchema,
  SavedPageSchema,
} from '../../src/lib/library';

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
  readonly cache: RequestCache | undefined;
};

const article = (id: string, extra: Partial<Article> = {}): Article => ({
  id,
  title: `Article ${id}`,
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: false,
  feedId: Option.none(),
  url: Option.none(),
  description: Option.none(),
  content: Option.none(),
  extractedContent: Option.none(),
  ...extra,
});

/** A saved page as the API returns it; its content is always present. */
const savedPageJson = (id: string, title = `Article ${id}`) =>
  Schema.encodeUnknownSync(SavedPageSchema)({
    id,
    ownerId: 'owner',
    url: Option.none(),
    title,
    description: Option.none(),
    content: '<p>Body</p>',
    publishedAt: '2026-01-01T00:00:00.000Z',
    read: false,
  });

/** The unified article a saved page maps to in the browser. */
const savedArticle = (id: string, title = `Article ${id}`): Article =>
  article(id, {
    title,
    content: Option.some('<p>Body</p>'),
    extractedContent: Option.some('<p>Body</p>'),
  });

/** A feed item as the API returns it. */
const feedItemJson = (id: string, feedId: string) =>
  Schema.encodeUnknownSync(FeedItemSchema)({
    id,
    feedId,
    url: Option.none(),
    title: `Article ${id}`,
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: '2026-01-01T00:00:00.000Z',
    read: false,
  });

const feedArticle = (id: string, feedId: string): Article =>
  article(id, { feedId: Option.some(feedId) });

const feed = (id: string): Feed => ({
  id,
  ownerId: 'owner',
  url: `https://example.com/${id}.xml`,
  title: `Feed ${id}`,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const preview: Preview = {
  url: 'https://example.com/feed.xml',
  title: 'Feed',
  description: Option.none(),
  titles: ['One'],
};

/** Encodes a preview back to the JSON shape the API returns. */
const previewJson = (item: Preview) =>
  Schema.encodeUnknownSync(PreviewSchema)(item);

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

const makeClient = (handler: Handler) => {
  const requests: Array<RecordedRequest> = [];
  const client = createLibraryClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const url = new URL(input);
      const request: RecordedRequest = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        params: url.searchParams,
        body:
          init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        credentials: init?.credentials,
        cache: init?.cache,
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

describe('library list requests', () => {
  it('lists later articles with the filter and cursor', async () => {
    const { client, requests } = makeClient(
      json({
        items: [savedPageJson('a')],
        cursor: 'next',
      })
    );
    const page = await client.list({ kind: 'later' }, 'unread', 'cursor-1');
    const request = requests[0];

    expect(request?.path).toBe('/api/library/saved-pages');
    expect(request?.method).toBe('GET');
    expect(request?.params.get('filter')).toBe('unread');
    expect(request?.params.get('cursor')).toBe('cursor-1');
    expect(request?.params.get('feedId')).toBeNull();
    expect(request?.credentials).toBe('include');
    expect(request?.cache).toBe('no-store');
    expect(page).toEqual({
      items: [savedArticle('a')],
      cursor: 'next',
    });
  });

  it('rejects a page that omits the cursor', async () => {
    const { client, requests } = makeClient(json({ items: [] }));

    expect(
      await failure(client.list({ kind: 'feeds', feedId: 'feed-1' }, 'all'))
    ).toMatchObject({ tag: 'InvalidResponse' });
    expect(requests[0]?.path).toBe('/api/library/feeds/items');
    expect(requests[0]?.params.get('feedId')).toBe('feed-1');
  });
});

describe('library feed scope', () => {
  it('lists every subscribed feed when no feed is selected', async () => {
    const { client, requests } = makeClient(json({ items: [], cursor: null }));
    await client.list({ kind: 'feeds' }, 'read');

    expect(requests[0]?.params.get('feedId')).toBeNull();
    expect(requests[0]?.params.get('filter')).toBe('read');
  });
});

describe('library reads', () => {
  it('reads subscriptions', async () => {
    const { client } = makeClient(json({ items: [feed('f1')] }));

    expect(await client.feeds()).toEqual([feed('f1')]);
  });

  it('reads the combined unread counts in one request', async () => {
    const { client, requests } = makeClient(
      json({
        saved: 3,
        feedsTotal: 5,
        feeds: [
          { id: 'f1', count: 2 },
          { id: 'f2', count: 3 },
        ],
      })
    );

    expect(await client.unreadCounts()).toEqual({
      later: 3,
      feedsTotal: 5,
      feeds: { f1: 2, f2: 3 },
    });
    expect(requests.map((request) => request.path)).toEqual([
      '/api/library/unread',
    ]);
  });

  it('reports a failed unread counts request', async () => {
    const { client } = makeClient(() =>
      Response.json({ _tag: 'FeedItemRepositoryError' }, { status: 500 })
    );

    expect(await failure(client.unreadCounts())).toMatchObject({
      tag: 'FeedItemRepositoryError',
    });
  });

  it('rejects unread counts that omit the feed totals', async () => {
    const { client } = makeClient(json({ saved: 3, feeds: [] }));

    expect(await failure(client.unreadCounts())).toMatchObject({
      tag: 'InvalidResponse',
    });
  });

  it('reads a saved page by id and reports deletion as null', async () => {
    const found = makeClient(json({ item: savedPageJson('a', 'One') }));
    const missing = makeClient(json({ item: null }));

    expect(await found.client.article({ id: 'a', feedId: undefined })).toEqual(
      savedArticle('a', 'One')
    );
    expect(found.requests[0]?.path).toBe('/api/library/saved-pages/item');
    expect(found.requests[0]?.params.get('id')).toBe('a');
    expect(
      await missing.client.article({ id: 'gone', feedId: undefined })
    ).toBeNull();
  });

  it('reads a feed item through its feed', async () => {
    const found = makeClient(json({ item: feedItemJson('a', 'f1') }));

    expect(await found.client.article({ id: 'a', feedId: 'f1' })).toEqual(
      feedArticle('a', 'f1')
    );
    expect(found.requests[0]?.path).toBe('/api/library/feeds/items/item');
    expect(found.requests[0]?.params.get('feedId')).toBe('f1');
    expect(found.requests[0]?.params.get('id')).toBe('a');
  });
});

describe('library article writes', () => {
  it('sends saved page and feed item mutations as JSON payloads', async () => {
    const { client, requests } = makeClient((current) => {
      if (
        current.path === '/api/library/saved-pages' &&
        current.method === 'POST'
      ) {
        return Response.json({ item: savedPageJson('a') }, { status: 201 });
      }

      if (current.path === '/api/library/feeds/items/extract') {
        return Response.json({ item: feedItemJson('a', 'f1') });
      }

      return Response.json({ item: savedPageJson('a') });
    });
    const saved = savedArticle('a');
    const fromFeed = feedArticle('a', 'f1');

    await client.markRead({ id: 'a', feedId: undefined }, true);
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/saved-pages',
      body: { id: 'a', read: true },
    });
    await client.markRead({ id: 'a', feedId: 'f1' }, false);
    expect(requests[1]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/feeds/items',
      body: { feedId: 'f1', id: 'a', read: false },
    });
    await client.markLater();
    expect(requests[2]).toMatchObject({
      path: '/api/library/saved-pages/mark-all-read',
      body: {},
    });
    await client.markFeeds(['f1', 'f2']);
    expect(requests[3]).toMatchObject({
      path: '/api/library/feeds/mark-read',
      body: { feedIds: ['f1', 'f2'] },
    });
    await client.markArticles([
      { id: 's1', feedId: undefined },
      { id: 'a', feedId: 'f1' },
      { id: 'b', feedId: 'f1' },
      { id: 'c', feedId: 'f2' },
    ]);
    expect(requests.slice(4).map(({ path, body }) => ({ path, body }))).toEqual(
      [
        { path: '/api/library/saved-pages/mark-read', body: { ids: ['s1'] } },
        {
          path: '/api/library/feeds/items/mark-read',
          body: { feedId: 'f1', ids: ['a', 'b'] },
        },
        {
          path: '/api/library/feeds/items/mark-read',
          body: { feedId: 'f2', ids: ['c'] },
        },
      ]
    );
    await client.remove('a');
    expect(requests[7]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/saved-pages',
      body: { id: 'a' },
    });
    expect(await client.add('https://example.com/post')).toEqual(saved);
    expect(requests[8]?.body).toEqual({ url: 'https://example.com/post' });
    expect(await client.save(fromFeed)).toEqual(saved);
    expect(requests[9]).toMatchObject({
      path: '/api/library/saved-pages/from-feed-item',
      body: { feedId: 'f1', id: 'a' },
    });
    expect(await client.extract(fromFeed)).toEqual(fromFeed);
    expect(requests[10]).toMatchObject({
      path: '/api/library/feeds/items/extract',
      body: { feedId: 'f1', id: 'a' },
    });
  });

  it('keeps saved pages as they are when saving or extracting', async () => {
    const { client, requests } = makeClient(() => Response.json({}));
    const saved = savedArticle('a');

    expect(await client.save(saved)).toBe(saved);
    expect(await client.extract(saved)).toBe(saved);
    expect(requests).toEqual([]);
  });
});

describe('library subscription writes', () => {
  it('sends preview, subscribe, and unsubscribe payloads', async () => {
    const { client, requests } = makeClient((current) => {
      if (current.path === '/api/library/feeds/preview') {
        return Response.json({ preview: previewJson(preview) });
      }

      if (current.method === 'POST') {
        return Response.json({ item: feed('f1') });
      }

      return Response.json({ ok: true });
    });

    expect(await client.preview('https://example.com/feed.xml')).toEqual(
      preview
    );
    expect(await client.subscribe('https://example.com/feed.xml')).toEqual(
      feed('f1')
    );
    await client.unsubscribe('f1');
    expect(requests[0]?.body).toEqual({ url: 'https://example.com/feed.xml' });
    expect(requests[1]?.body).toEqual({ url: 'https://example.com/feed.xml' });
    expect(requests[2]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/feeds',
      body: { id: 'f1' },
    });
  });
});

describe('library error tags', () => {
  it('keeps the API tag and id with a Chinese message', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'DuplicateSavedPage',
          message: 'Article already exists',
          id: 'a1',
        },
        409
      )
    );
    const error = await failure(client.add('https://example.com/post'));

    expect(error).toBeInstanceOf(LibraryError);
    expect(error).toMatchObject({
      tag: 'DuplicateSavedPage',
      id: 'a1',
      message: '该文章已在稍后阅读中',
    });
  });

  it('keeps the existing feed id for a duplicate subscription', async () => {
    const { client } = makeClient(
      json({ _tag: 'FeedExists', message: 'Exists', id: 'f1' }, 409)
    );
    const error = await failure(
      client.subscribe('https://example.com/feed.xml')
    );

    expect(error).toMatchObject({
      tag: 'FeedExists',
      id: 'f1',
      message: '该订阅已存在',
    });
  });

  it('localizes a fetcher failure despite its API message', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'WebpageFetcherError',
          message: 'The page blocked automated access',
        },
        422
      )
    );
    const error = await failure(client.add('https://example.com/missing'));

    expect(error).toMatchObject({
      tag: 'WebpageFetcherError',
      message: '网页抓取失败，请稍后重试',
    });
  });

  it('localizes a fetcher failure that carries no message', async () => {
    const { client } = makeClient(json({ _tag: 'WebpageFetcherError' }, 422));

    expect(
      await failure(client.add('https://example.com/missing'))
    ).toMatchObject({
      tag: 'WebpageFetcherError',
      message: '网页抓取失败，请稍后重试',
    });
  });

  it('localizes parser and extractor failures despite their API message', async () => {
    const parser = makeClient(
      json({ _tag: 'FeedParserError', message: 'Malformed feed' }, 422)
    );
    const extractor = makeClient(
      json({ _tag: 'ArticleExtractorError', message: 'No readable text' }, 422)
    );

    expect(await failure(parser.client.feeds())).toMatchObject({
      tag: 'FeedParserError',
      message: '无法解析订阅源，请确认地址正确',
    });
    expect(await failure(extractor.client.feeds())).toMatchObject({
      tag: 'ArticleExtractorError',
      message: '正文提取失败，请稍后重试',
    });
  });
});

describe('library error fallbacks', () => {
  it('maps bare 401 bodies and unknown tags to local failures', async () => {
    const unauthorized = makeClient(json({ error: 'Unauthorized' }, 401));
    const unknown = makeClient(
      json({ _tag: 'SomethingNew', message: 'Nope' }, 500)
    );

    expect(await failure(unauthorized.client.feeds())).toMatchObject({
      tag: 'Unauthorized',
      message: '登录状态已失效，请重新登录',
    });
    expect(await failure(unknown.client.feeds())).toMatchObject({
      tag: 'RequestFailed',
      message: '请求失败，请稍后重试',
    });
  });

  it('maps network, malformed JSON, and invalid payloads', async () => {
    const offline = createLibraryClient({
      baseUrl: 'http://api.test',
      fetch: () => Promise.reject(new Error('offline')),
    });
    const broken = makeClient(() => new Response('not json', { status: 200 }));
    const invalid = makeClient(json({ items: [{ id: 'a' }] }));

    expect(await failure(offline.feeds())).toMatchObject({
      tag: 'NetworkError',
    });
    expect(await failure(broken.client.feeds())).toMatchObject({
      tag: 'InvalidResponse',
    });
    expect(
      await failure(invalid.client.list({ kind: 'later' }, 'all'))
    ).toMatchObject({
      tag: 'InvalidResponse',
      message: '响应数据格式不正确，请稍后重试',
    });
  });
});
