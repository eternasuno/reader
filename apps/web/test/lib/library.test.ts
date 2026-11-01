// biome-ignore-all lint/style/noExcessiveLinesPerFile: the transport test covers every endpoint and error mapping in one client boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped endpoint cases stay together with their shared request fixture.
import { describe, expect, it } from 'vitest';
import {
  type Article,
  createLibraryClient,
  type Feed,
  LibraryError,
  type Preview,
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
  ownerId: 'owner',
  title: `Article ${id}`,
  publishedAt: '2026-01-01T00:00:00.000Z',
  read: false,
  ...extra,
});

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
  titles: ['One'],
};

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

const makeClient = (handler: Handler) => {
  const requests: RecordedRequest[] = [];
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
      json({ items: [article('a')], cursor: 'next', boundary: 'top' })
    );
    const page = await client.list({ kind: 'later' }, 'unread', 'cursor-1');
    const request = requests[0];

    expect(request?.path).toBe('/api/library/later');
    expect(request?.method).toBe('GET');
    expect(request?.params.get('filter')).toBe('unread');
    expect(request?.params.get('cursor')).toBe('cursor-1');
    expect(request?.params.get('feedId')).toBeNull();
    expect(request?.credentials).toBe('include');
    expect(request?.cache).toBe('no-store');
    expect(page).toEqual({
      items: [article('a')],
      cursor: 'next',
      boundary: 'top',
    });
  });

  it('rejects a page that omits the boundary', async () => {
    const { client, requests } = makeClient(json({ items: [], cursor: null }));

    expect(
      await failure(client.list({ kind: 'feeds', feedId: 'feed-1' }, 'all'))
    ).toMatchObject({ tag: 'InvalidResponse' });
    expect(requests[0]?.path).toBe('/api/library/feeds/articles');
    expect(requests[0]?.params.get('feedId')).toBe('feed-1');
  });
});

describe('library feed scope', () => {
  it('lists every subscribed feed when no feed is selected', async () => {
    const { client, requests } = makeClient(
      json({ items: [], cursor: null, boundary: null })
    );
    await client.list({ kind: 'feeds' }, 'read');

    expect(requests[0]?.params.get('feedId')).toBeNull();
    expect(requests[0]?.params.get('filter')).toBe('read');
  });

  it('syncs through the stored boundary of the loaded tail', async () => {
    const { client, requests } = makeClient(json({ items: [article('new')] }));
    const items = await client.refresh(
      { kind: 'feeds', feedId: 'feed-1' },
      'unread',
      'boundary-1'
    );

    expect(requests[0]?.path).toBe('/api/library/feeds/refresh');
    expect(requests[0]?.params.get('through')).toBe('boundary-1');
    expect(requests[0]?.params.get('filter')).toBe('unread');
    expect(items).toEqual([article('new')]);
  });
});

describe('library reads', () => {
  it('reads subscriptions', async () => {
    const { client } = makeClient(json({ items: [feed('f1')] }));

    expect(await client.feeds()).toEqual([feed('f1')]);
  });

  it('reads later and feed unread counts independently', async () => {
    const { client, requests } = makeClient((current) => {
      if (current.path === '/api/library/later/unread') {
        return Response.json({ count: 3 });
      }

      return Response.json({
        total: 5,
        feeds: [
          { id: 'f1', count: 2 },
          { id: 'f2', count: 3 },
        ],
      });
    });

    expect(await client.laterUnread()).toBe(3);
    expect(await client.feedUnread()).toEqual({
      total: 5,
      feeds: { f1: 2, f2: 3 },
    });
    expect(requests.map((request) => request.path)).toEqual([
      '/api/library/later/unread',
      '/api/library/feeds/unread',
    ]);
  });

  it('keeps one unread query usable when the other fails', async () => {
    const { client } = makeClient((current) =>
      current.path === '/api/library/later/unread'
        ? Response.json({ _tag: 'ArticleReadError' }, { status: 500 })
        : Response.json({ total: 2, feeds: [{ id: 'f1', count: 2 }] })
    );

    expect(await failure(client.laterUnread())).toMatchObject({
      tag: 'ArticleReadError',
    });
    expect(await client.feedUnread()).toEqual({
      total: 2,
      feeds: { f1: 2 },
    });
  });

  it('reads one article and reports deletion as null', async () => {
    const found = makeClient(json({ item: article('a', { title: 'One' }) }));
    const missing = makeClient(json({ item: null }));

    expect(await found.client.article('a')).toEqual(
      article('a', { title: 'One' })
    );
    expect(found.requests[0]?.params.get('id')).toBe('a');
    expect(await missing.client.article('gone')).toBeNull();
  });
});

describe('library article writes', () => {
  it('sends article mutations as JSON payloads', async () => {
    const { client, requests } = makeClient((current) =>
      current.method === 'POST' && current.path === '/api/library/articles'
        ? Response.json({ item: article('a') }, { status: 201 })
        : Response.json({ item: article('a') })
    );

    await client.markRead('a', true);
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/articles',
      body: { id: 'a', read: true },
    });
    await client.markLater();
    expect(requests[1]?.body).toEqual({});
    await client.markFeeds(['f1', 'f2']);
    expect(requests[2]?.body).toEqual({ feedIds: ['f1', 'f2'] });
    await client.markArticles(['a']);
    expect(requests[3]?.body).toEqual({ ids: ['a'] });
    await client.remove('a');
    expect(requests[4]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/articles',
      body: { id: 'a' },
    });
    expect(await client.add('https://example.com/post')).toEqual(article('a'));
    expect(requests[5]?.body).toEqual({ url: 'https://example.com/post' });
    expect(await client.save('a')).toEqual(article('a'));
    expect(requests[6]?.body).toEqual({ id: 'a' });
    expect(await client.extract('a')).toEqual(article('a'));
    expect(requests[7]?.body).toEqual({ id: 'a' });
  });
});

describe('library subscription writes', () => {
  it('sends preview, subscribe, and unsubscribe payloads', async () => {
    const { client, requests } = makeClient((current) => {
      if (current.path === '/api/library/feeds/preview') {
        return Response.json({ preview });
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
          _tag: 'DuplicateArticle',
          message: 'Article already exists',
          id: 'a1',
        },
        409
      )
    );
    const error = await failure(client.add('https://example.com/post'));

    expect(error).toBeInstanceOf(LibraryError);
    expect(error).toMatchObject({
      tag: 'DuplicateArticle',
      id: 'a1',
      code: undefined,
      message: '该文章已在稍后阅读中',
    });
  });

  it('keeps the existing feed id for a duplicate subscription', async () => {
    const { client } = makeClient(
      json({ _tag: 'SubscriptionExists', message: 'Exists', id: 'f1' }, 409)
    );
    const error = await failure(
      client.subscribe('https://example.com/feed.xml')
    );

    expect(error).toMatchObject({
      tag: 'SubscriptionExists',
      id: 'f1',
      message: '该订阅已存在',
    });
  });

  it('carries the fetch code reported by the API', async () => {
    const { client } = makeClient(
      json(
        {
          _tag: 'WebpageFetchError',
          message: 'Unable to fetch the article page',
          code: 'HTTP_404',
        },
        422
      )
    );
    const error = await failure(client.add('https://example.com/missing'));

    expect(error).toMatchObject({
      tag: 'WebpageFetchError',
      code: 'HTTP_404',
      message: '网页抓取失败，请稍后重试',
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
