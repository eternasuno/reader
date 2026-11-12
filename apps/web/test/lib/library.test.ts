// biome-ignore-all lint/style/noExcessiveLinesPerFile: the transport test covers every endpoint and error mapping in one client boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped endpoint cases stay together with their shared request fixture.
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type Article,
  createLibraryClient,
  type Feed,
  type FeedItem,
  FeedItemSchema,
  FeedSchema,
  LibraryError,
  PAGE_SIZE,
  type Preview,
  PreviewSchema,
  type SavedPage,
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
  publishedAt: undefined,
  read: false,
  feedId: Option.none(),
  url: Option.none(),
  description: Option.none(),
  content: Option.none(),
  extractedContent: Option.none(),
  ...extra,
});

const savedPage = (id: string, title = `Article ${id}`): SavedPage => ({
  id,
  ownerId: 'owner',
  url: `https://example.com/${id}`,
  title,
  description: Option.none(),
  content: '<p>Body</p>',
  publishedAt: Option.none(),
  read: false,
});

/** A saved page as the API returns it: absent optional fields are omitted. */
const savedPageJson = (id: string, title = `Article ${id}`) =>
  Schema.encodeUnknownSync(SavedPageSchema)(savedPage(id, title));

const savedArticle = (id: string, title = `Article ${id}`): Article =>
  article(id, {
    title,
    url: Option.some(`https://example.com/${id}`),
    content: Option.some('<p>Body</p>'),
    extractedContent: Option.some('<p>Body</p>'),
  });

const feedItem = (id: string, feedId: string): FeedItem => ({
  id,
  ownerId: 'owner',
  feedId,
  url: `https://example.com/${feedId}/${id}`,
  title: `Article ${id}`,
  description: Option.none(),
  content: Option.none(),
  extractedContent: Option.none(),
  publishedAt: Option.none(),
  read: false,
});

const feedItemJson = (id: string, feedId: string) =>
  Schema.encodeUnknownSync(FeedItemSchema)(feedItem(id, feedId));

const feedArticle = (id: string, feedId: string): Article =>
  article(id, {
    feedId: Option.some(feedId),
    url: Option.some(`https://example.com/${feedId}/${id}`),
  });

const feed = (id: string): Feed => ({
  id,
  ownerId: 'owner',
  url: `https://example.com/${id}.xml`,
  title: `Feed ${id}`,
  updatedAt: Option.none(),
});

const feedJson = (id: string) => Schema.encodeUnknownSync(FeedSchema)(feed(id));

const preview: Preview = {
  url: 'https://example.com/feed.xml',
  title: 'Feed',
  description: Option.none(),
  titles: ['One'],
};

const previewJson = () => Schema.encodeUnknownSync(PreviewSchema)(preview);

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

const idsBody = (request: RecordedRequest): ReadonlyArray<string> =>
  (request.body as { readonly ids: ReadonlyArray<string> }).ids;

describe('library list requests', () => {
  it('lists saved pages with the unread flag, page size, and cursor', async () => {
    const { client, requests } = makeClient(
      json({ items: [savedPageJson('a')], cursor: 'next' })
    );
    const page = await client.list({ kind: 'later' }, true, 'cursor-1');
    const request = requests[0];

    expect(request?.path).toBe('/api/library/saved-pages');
    expect(request?.method).toBe('GET');
    expect(request?.params.get('unreadOnly')).toBe('true');
    expect(request?.params.get('limit')).toBe(String(PAGE_SIZE));
    expect(PAGE_SIZE).toBe(30);
    expect(request?.params.get('cursor')).toBe('cursor-1');
    expect(request?.params.get('feedId')).toBeNull();
    expect(request?.credentials).toBe('include');
    expect(request?.cache).toBe('no-store');
    expect(page).toEqual({ items: [savedArticle('a')], cursor: 'next' });
  });

  it('lists one feed with the selected feed id', async () => {
    const { client, requests } = makeClient(
      json({ items: [feedItemJson('a', 'feed-1')], cursor: null })
    );
    const page = await client.list({ kind: 'feeds', feedId: 'feed-1' }, false);

    expect(requests[0]?.path).toBe('/api/library/feeds/items');
    expect(requests[0]?.params.get('feedId')).toBe('feed-1');
    expect(requests[0]?.params.get('unreadOnly')).toBe('false');
    expect(requests[0]?.params.get('limit')).toBe('30');
    expect(requests[0]?.params.get('cursor')).toBeNull();
    expect(page).toEqual({
      items: [feedArticle('a', 'feed-1')],
      cursor: null,
    });
  });

  it('lists every subscribed feed without a feed filter', async () => {
    const { client, requests } = makeClient(json({ items: [], cursor: null }));
    await client.list({ kind: 'feeds' }, true);

    expect(requests[0]?.path).toBe('/api/library/feeds/items');
    expect(requests[0]?.params.get('feedId')).toBeNull();
    expect(requests[0]?.params.get('unreadOnly')).toBe('true');
  });

  it('rejects a page without a cursor field', async () => {
    const { client } = makeClient(json({ items: [] }));

    expect(await failure(client.list({ kind: 'later' }, true))).toMatchObject({
      tag: 'InvalidResponse',
    });
  });
});

describe('library reads', () => {
  it('reads subscriptions without a sync timestamp', async () => {
    const { client, requests } = makeClient(json({ items: [feedJson('f1')] }));

    expect(await client.feeds()).toEqual([feed('f1')]);
    expect(requests[0]?.cache).toBe('no-store');
  });

  it('composes the two unread count requests', async () => {
    const { client, requests } = makeClient((request) =>
      request.path === '/api/library/feeds/unread'
        ? Response.json({
            feeds: [
              { feedId: 'f1', count: 2 },
              { feedId: 'f2', count: 3 },
            ],
          })
        : Response.json({ count: 4 })
    );

    expect(await client.unreadCounts()).toEqual({
      later: 4,
      feedsTotal: 5,
      feeds: { f1: 2, f2: 3 },
    });
    expect(requests.map((request) => request.path).sort()).toEqual([
      '/api/library/feeds/unread',
      '/api/library/saved-pages/unread',
    ]);
  });

  it('reports a failed unread count request', async () => {
    const { client } = makeClient(
      json({ _tag: 'FeedItemRepositoryError' }, 500)
    );

    expect(await failure(client.unreadCounts())).toMatchObject({
      tag: 'FeedItemRepositoryError',
    });
  });

  it('rejects unread counts without a count', async () => {
    const { client } = makeClient((request) =>
      request.path === '/api/library/feeds/unread'
        ? Response.json({ feeds: [] })
        : Response.json({})
    );

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
    expect(found.requests[0]?.params.get('feedId')).toBeNull();
    expect(
      await missing.client.article({ id: 'gone', feedId: undefined })
    ).toBeNull();
  });

  it('reads a feed item by id alone', async () => {
    const found = makeClient(json({ item: feedItemJson('a', 'f1') }));

    expect(await found.client.article({ id: 'a', feedId: 'f1' })).toEqual(
      feedArticle('a', 'f1')
    );
    expect(found.requests[0]?.path).toBe('/api/library/feeds/items/item');
    expect(found.requests[0]?.params.get('id')).toBe('a');
    expect(found.requests[0]?.params.get('feedId')).toBeNull();
  });

  it('looks a saved page up by url', async () => {
    const found = makeClient(json({ item: savedPageJson('a', 'One') }));
    const missing = makeClient(json({ item: null }));

    expect(
      await found.client.findSavedPageByUrl('https://example.com/a')
    ).toEqual(savedArticle('a', 'One'));
    expect(found.requests[0]?.path).toBe('/api/library/saved-pages/by-url');
    expect(found.requests[0]?.params.get('url')).toBe('https://example.com/a');
    expect(found.requests[0]?.cache).toBe('no-store');
    expect(
      await missing.client.findSavedPageByUrl('https://example.com/gone')
    ).toBeNull();
  });
});

describe('library article writes', () => {
  it('marks read through the endpoint picked by the reference', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

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
      body: { id: 'a', read: false },
    });
  });

  it('marks whole scopes read', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.markLater();
    await client.markAllFeeds();
    await client.markFeeds(['f1', 'f2']);

    expect(requests.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: '/api/library/saved-pages/mark-all-read', body: {} },
      { path: '/api/library/feeds/mark-all-read', body: {} },
      {
        path: '/api/library/feeds/mark-read',
        body: { feedIds: ['f1', 'f2'] },
      },
    ]);
  });

  it('marks article batches per endpoint with the ids alone', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.markArticles([
      { id: 's1', feedId: undefined },
      { id: 'a', feedId: 'f1' },
      { id: 'b', feedId: 'f1' },
      { id: 'c', feedId: 'f2' },
      { id: 's2', feedId: undefined },
    ]);

    expect(requests.map(({ path, body }) => ({ path, body }))).toEqual([
      {
        path: '/api/library/saved-pages/mark-read',
        body: { ids: ['s1', 's2'] },
      },
      {
        path: '/api/library/feeds/items/mark-read',
        body: { ids: ['a', 'b', 'c'] },
      },
    ]);
  });

  it('chunks mark-read batches at 5000 ids', async () => {
    const { client, requests } = makeClient(json({ ok: true }));
    const refs = Array.from({ length: 5001 }, (_, index) => ({
      id: `s${index}`,
      feedId: undefined,
    }));

    await client.markArticles(refs);

    expect(requests.map((request) => idsBody(request).length)).toEqual([
      5000, 1,
    ]);
    expect(
      requests.every(
        (request) => request.path === '/api/library/saved-pages/mark-read'
      )
    ).toBe(true);
  });

  it('deletes saved pages and saves a feed item by id', async () => {
    const { client, requests } = makeClient((request) => {
      if (request.path === '/api/library/saved-pages/from-feed-item') {
        return Response.json({ item: savedPageJson('a') }, { status: 201 });
      }

      return Response.json({ ok: true });
    });

    await client.remove('a');
    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/saved-pages',
      body: { id: 'a' },
    });
    expect(await client.save(feedArticle('a', 'f1'))).toEqual(
      savedArticle('a')
    );
    expect(requests[1]).toMatchObject({
      method: 'POST',
      path: '/api/library/saved-pages/from-feed-item',
      body: { id: 'a' },
    });
  });

  it('adds a saved page and extracts a feed item by id', async () => {
    const { client, requests } = makeClient((request) => {
      if (request.path === '/api/library/feeds/items/extract') {
        return Response.json({ item: feedItemJson('a', 'f1') });
      }

      return Response.json({ item: savedPageJson('a') }, { status: 201 });
    });

    expect(await client.add('https://example.com/post')).toEqual(
      savedArticle('a')
    );
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/library/saved-pages',
      body: { url: 'https://example.com/post' },
    });
    expect(await client.extract(feedArticle('a', 'f1'))).toEqual(
      feedArticle('a', 'f1')
    );
    expect(requests[1]).toMatchObject({
      method: 'POST',
      path: '/api/library/feeds/items/extract',
      body: { id: 'a' },
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
        return Response.json({ preview: previewJson() });
      }

      if (current.method === 'POST') {
        return Response.json({ item: feedJson('f1') }, { status: 201 });
      }

      return Response.json({ ok: true });
    });

    expect(await client.preview('https://example.com/feed.xml')).toEqual(
      preview
    );
    expect(
      await client.subscribe('https://example.com/feed.xml', 'Feed')
    ).toEqual(feed('f1'));
    await client.unsubscribe('f1');
    expect(requests[0]?.body).toEqual({ url: 'https://example.com/feed.xml' });
    expect(requests[1]?.body).toEqual({
      url: 'https://example.com/feed.xml',
      title: 'Feed',
    });
    expect(requests[2]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/feeds',
      body: { id: 'f1' },
    });
  });
});

describe('library error tags', () => {
  it('keeps the saved page url for a duplicate article', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'SavedPageAlreadyExists',
          message: 'Article already exists',
          url: 'https://example.com/post',
        },
        409
      )
    );
    const error = await failure(client.add('https://example.com/post'));

    expect(error).toBeInstanceOf(LibraryError);
    expect(error).toMatchObject({
      tag: 'SavedPageAlreadyExists',
      url: 'https://example.com/post',
      id: undefined,
      message: '该文章已在稍后阅读中',
    });
  });

  it('keeps the url for a duplicate subscription', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'FeedAlreadyExists',
          message: 'Exists',
          url: 'https://example.com/feed.xml',
        },
        409
      )
    );
    const error = await failure(
      client.subscribe('https://example.com/feed.xml', 'Feed')
    );

    expect(error).toMatchObject({
      tag: 'FeedAlreadyExists',
      url: 'https://example.com/feed.xml',
      message: '该订阅已存在',
    });
  });

  it('keeps the item id for a missing article', async () => {
    const { client } = makeClient(
      json({ _tag: 'FeedItemNotFound', message: 'Missing', id: 'a1' }, 404)
    );

    expect(
      await failure(client.extract(feedArticle('a1', 'f1')))
    ).toMatchObject({
      tag: 'FeedItemNotFound',
      id: 'a1',
      message: '文章不存在，可能已被删除',
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

  it('localizes parser and extractor failures', async () => {
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

  it('maps tags removed from the API to a plain request failure', async () => {
    const removed = makeClient(
      json({ _tag: 'FeedExists', message: 'Exists', id: 'f1' }, 409)
    );

    expect(await failure(removed.client.feeds())).toMatchObject({
      tag: 'RequestFailed',
      message: '请求失败，请稍后重试',
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
    const invalid = makeClient(json({ items: [{ id: 'a' }], cursor: null }));

    expect(await failure(offline.feeds())).toMatchObject({
      tag: 'NetworkError',
    });
    expect(await failure(broken.client.feeds())).toMatchObject({
      tag: 'InvalidResponse',
    });
    expect(
      await failure(invalid.client.list({ kind: 'later' }, true))
    ).toMatchObject({
      tag: 'InvalidResponse',
      message: '响应数据格式不正确，请稍后重试',
    });
  });
});
