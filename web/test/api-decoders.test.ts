import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authApi,
  feedItemsApi,
  feedsApi,
  foldersApi,
  kindleApi,
  savedPagesApi,
  settingsApi,
} from '../src/api';

let fetchMock: ReturnType<typeof vi.fn>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feed = {
  id: 'f',
  url: 'https://example.com',
  title: 'F',
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
};
const feedItem = {
  id: 'i',
  feedId: 'f',
  url: 'https://example.com',
  title: 'I',
  read: false,
};
const send = {
  id: 's',
  trigger: 'manual',
  status: 'running',
  startedAt: '2026-11-24T00:00:00Z',
};

describe('response field validation', () => {
  it.each([
    '',
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:pass@example.com',
  ])('rejects unsafe URL %s', async (url) => {
    for (const [run, body] of [
      [() => feedsApi.list(), { items: [{ ...feed, url }] }],
      [
        () => feedsApi.preview('https://example.com'),
        { preview: { url, title: 'F', titles: [] } },
      ],
      [() => feedItemsApi.getById('i'), { item: { ...feedItem, url } }],
      [
        () => savedPagesApi.getById('p'),
        { item: { id: 'p', url, title: 'P', content: '', read: false } },
      ],
    ] as Array<[() => Promise<unknown>, unknown]>) {
      fetchMock.mockResolvedValueOnce(jsonResponse(body));
      await expect(run()).rejects.toMatchObject({ code: 'InvalidResponse' });
    }
  });

  it.each([
    { id: undefined },
    { id: '' },
    { startedAt: undefined },
    { startedAt: '' },
    { startedAt: 'invalid' },
  ])('rejects invalid Kindle record %o', async (patch) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ running: true, items: [{ ...send, ...patch }] })
    );
    await expect(kindleApi.listSends()).rejects.toMatchObject({
      code: 'InvalidResponse',
    });
  });

  it.each([undefined, '', '   '])(
    'rejects extraction without content %s',
    async (extractedContent) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ item: { ...feedItem, extractedContent } })
      );
      await expect(feedItemsApi.extract('i')).rejects.toMatchObject({
        code: 'InvalidResponse',
      });
    }
  );
});

describe('empty or non-JSON bodies on JSON endpoints', () => {
  it.each([
    ['204 no content', new Response(null, { status: 204 }), 204],
    ['empty body', new Response('', { status: 200 }), 200],
    ['invalid JSON', new Response('{bad', { status: 200 }), 200],
  ])('rejects %s with InvalidResponse', async (_, response, status) => {
    fetchMock.mockResolvedValueOnce(response);

    await expect(authApi.getSession()).rejects.toMatchObject({
      code: 'InvalidResponse',
      status,
    });
  });

  it('accepts { item: null } for nullable item endpoints', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: null }));
    await expect(savedPagesApi.getById('missing')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ item: null }));
    await expect(feedItemsApi.getById('missing')).resolves.toBeNull();
  });
});

const MALFORMED_CASES: Array<[string, () => Promise<unknown>, unknown]> = [
  ['authApi.getSession', () => authApi.getSession(), { authenticated: 'yes' }],
  [
    'savedPagesApi.list (missing cursor)',
    () => savedPagesApi.list(),
    { items: [] },
  ],
  [
    'savedPagesApi.list (invalid item)',
    () => savedPagesApi.list(),
    { items: [{ id: '1' }], cursor: null },
  ],
  [
    'savedPagesApi.unreadCount',
    () => savedPagesApi.unreadCount(),
    { count: '3' },
  ],
  [
    'savedPagesApi.getById',
    () => savedPagesApi.getById('p1'),
    { item: { id: 'p1' } },
  ],
  [
    'savedPagesApi.create',
    () => savedPagesApi.create('https://example.com'),
    { item: null },
  ],
  ['savedPagesApi.saveFeedItem', () => savedPagesApi.saveFeedItem('i1'), {}],
  [
    'foldersApi.list',
    () => foldersApi.list(),
    { items: [{ id: 1, name: 'x' }] },
  ],
  ['foldersApi.create', () => foldersApi.create('x'), { item: { id: '1' } }],
  [
    'foldersApi.listItems',
    () => foldersApi.listItems('f1'),
    { items: 'bad', cursor: null },
  ],
  ['feedsApi.list', () => feedsApi.list(), { items: [{ id: 'f1', url: 'u' }] }],
  [
    'feedsApi.preview',
    () => feedsApi.preview('https://example.com/feed.xml'),
    { preview: { url: 'u', title: 't', titles: [123] } },
  ],
  [
    'feedsApi.create',
    () => feedsApi.create({ url: 'https://example.com/feed.xml' }),
    { item: { id: 'f1' } },
  ],
  [
    'feedsApi.unreadCounts',
    () => feedsApi.unreadCounts(),
    { items: [{ feedId: 'f1', count: '2' }] },
  ],
  [
    'feedsApi.listItems',
    () => feedsApi.listItems('f1'),
    { items: [{ id: 'i1', feedId: 'f1', read: false }], cursor: 123 },
  ],
  [
    'feedsApi.importOpml',
    () => feedsApi.importOpml('<opml/>'),
    { importedFeeds: 1, skippedFeeds: 0 },
  ],
  [
    'feedItemsApi.listAll',
    () => feedItemsApi.listAll(),
    { items: [{ id: 'i1' }], cursor: null },
  ],
  ['feedItemsApi.getById', () => feedItemsApi.getById('i1'), { item: 'bad' }],
  ['feedItemsApi.extract', () => feedItemsApi.extract('i1'), { item: null }],
  [
    'settingsApi.get',
    () => settingsApi.get(),
    { retention: 100, provider: 'unknown' },
  ],
  [
    'settingsApi.get (null smtp)',
    () => settingsApi.get(),
    {
      retention: 100,
      provider: 'direct',
      jinaKeyConfigured: false,
      browserEndpointConfigured: false,
      smtp: null,
    },
  ],
  [
    'kindleApi.sendNow',
    () => kindleApi.sendNow(),
    { item: { trigger: 'manual', status: 'succeeded' } },
  ],
  [
    'kindleApi.listSends',
    () => kindleApi.listSends(),
    { running: 'yes', items: [] },
  ],
];

describe('malformed endpoint payloads', () => {
  it.each(MALFORMED_CASES)(
    'rejects malformed payload for %s',
    async (_, run, badPayload) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(badPayload, 200));

      await expect(run()).rejects.toMatchObject({
        code: 'InvalidResponse',
        status: 200,
      });
    }
  );
});
