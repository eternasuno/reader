import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  feedItemsApi,
  feedsApi,
  foldersApi,
  kindleApi,
  savedPagesApi,
  settingsApi,
} from '../src/api';

const PAGE = 'https://example.com/a';
const VALID_PAGE = {
  id: 'p',
  url: PAGE,
  title: 'P',
  content: '<p>c</p>',
  read: false,
};
const VALID_FEED = {
  id: 'f',
  url: PAGE,
  title: 'F',
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
};
const VALID_PREVIEW = { url: PAGE, title: 'F', titles: ['Post 1'] };
const VALID_ITEM = { id: 'i', feedId: 'f', url: PAGE, title: 'I', read: false };
const VALID_FOLDER = { id: 'f', name: 't' };
const VALID_SETTINGS = {
  retention: 100,
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};
const VALID_SEND = {
  id: 's',
  trigger: 'manual',
  status: 'running',
  articleCount: 0,
  bookCount: 0,
  startedAt: '2026-11-24T00:00:00Z',
};

type UnwrapCase = [string, () => Promise<unknown>, unknown, number, unknown];

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

const UNWRAP_CASES: Array<UnwrapCase> = [
  [
    'savedPagesApi.unreadCount',
    () => savedPagesApi.unreadCount(),
    { count: 4 },
    200,
    4,
  ],
  [
    'savedPagesApi.getById',
    () => savedPagesApi.getById('p'),
    { item: VALID_PAGE },
    200,
    VALID_PAGE,
  ],
  [
    'savedPagesApi.create',
    () => savedPagesApi.create(PAGE),
    { item: VALID_PAGE },
    201,
    VALID_PAGE,
  ],
  [
    'feedsApi.list',
    () => feedsApi.list(),
    { items: [VALID_FEED] },
    200,
    [VALID_FEED],
  ],
  [
    'feedsApi.preview',
    () => feedsApi.preview(PAGE),
    { preview: VALID_PREVIEW },
    200,
    VALID_PREVIEW,
  ],
  [
    'feedsApi.create',
    () => feedsApi.create({ url: PAGE }),
    { item: VALID_FEED },
    201,
    VALID_FEED,
  ],
  [
    'feedsApi.unreadCounts',
    () => feedsApi.unreadCounts(),
    { items: [{ feedId: 'f', count: 2 }] },
    200,
    [{ feedId: 'f', count: 2 }],
  ],
  [
    'feedItemsApi.listAll',
    () => feedItemsApi.listAll(),
    { items: [VALID_ITEM], cursor: 'i' },
    200,
    { items: [VALID_ITEM], cursor: 'i' },
  ],
  [
    'feedItemsApi.extract',
    () => feedItemsApi.extract('i'),
    { item: { ...VALID_ITEM, extractedContent: '<p>extracted</p>' } },
    200,
    { ...VALID_ITEM, extractedContent: '<p>extracted</p>' },
  ],
  [
    'foldersApi.list',
    () => foldersApi.list(),
    { items: [VALID_FOLDER] },
    200,
    [VALID_FOLDER],
  ],
  [
    'foldersApi.create',
    () => foldersApi.create('t'),
    { item: VALID_FOLDER },
    201,
    VALID_FOLDER,
  ],
  [
    'settingsApi.get',
    () => settingsApi.get(),
    VALID_SETTINGS,
    200,
    VALID_SETTINGS,
  ],
  [
    'kindleApi.sendNow',
    () => kindleApi.sendNow(),
    { item: VALID_SEND },
    202,
    VALID_SEND,
  ],
  [
    'kindleApi.listSends',
    () => kindleApi.listSends(),
    { running: true, items: [VALID_SEND] },
    200,
    { running: true, items: [VALID_SEND] },
  ],
];

describe('response unwrapping', () => {
  it.each(UNWRAP_CASES)(
    'unwraps %s',
    async (_, run, body, status, expected) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
      await expect(run()).resolves.toEqual(expected);
    }
  );

  it('imports OPML from a string and a file', async () => {
    const result = { importedFeeds: 2, skippedFeeds: 1, createdFolders: 1 };
    const file = new File(['<opml/>'], 'a.opml', { type: 'text/xml' });
    fetchMock.mockImplementation(() => jsonResponse(result));
    await expect(feedsApi.importOpml('<opml/>')).resolves.toEqual(result);
    await expect(feedsApi.importOpml(file)).resolves.toEqual(result);

    const [stringCall, fileCall] = fetchMock.mock.calls;
    const stringInit = (stringCall?.[1] ?? {}) as RequestInit;
    const fileInit = (fileCall?.[1] ?? {}) as RequestInit;
    expect([String(stringCall?.[0]), stringInit.method]).toEqual([
      '/api/opml',
      'POST',
    ]);
    expect([
      stringInit.body,
      (stringInit.headers as Record<string, string>)['Content-Type'],
    ]).toEqual(['<opml/>', 'application/xml']);
    expect([String(fileCall?.[0]), fileInit.method]).toEqual([
      '/api/opml',
      'POST',
    ]);
    expect((fileInit.body as FormData).get('file')).toBe(file);
  });
});

describe('no-content statuses', () => {
  it.each([
    ['feed move', () => feedsApi.moveToFolder('f', null), 200],
    ['feed refresh', () => feedsApi.refresh('f'), 204],
    ['settings update', () => settingsApi.updateRetention(5), 202],
  ])('rejects unexpected success for %s', async (_, run, status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(run()).rejects.toMatchObject({
      code: 'InvalidResponse',
      status,
    });
  });
});

describe('error mapping', () => {
  it('maps network and malformed failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(feedsApi.list()).rejects.toMatchObject({
      code: 'NetworkError',
      status: 0,
    });

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(feedsApi.list()).rejects.toMatchObject({
      code: 'RequestFailed',
      status: 500,
    });
  });

  it('keeps backend codes, conflict URLs, and conflict IDs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'FeedAlreadyExists', url: PAGE }, 409)
    );
    await expect(feedsApi.create({ url: PAGE })).rejects.toMatchObject({
      code: 'FeedAlreadyExists',
      url: PAGE,
      id: undefined,
    });

    const body = { error: 'SavedPageAlreadyExists', id: 'page-9', url: PAGE };
    fetchMock.mockResolvedValueOnce(jsonResponse(body, 409));
    await expect(savedPagesApi.create(PAGE)).rejects.toMatchObject({
      code: 'SavedPageAlreadyExists',
      url: PAGE,
      id: 'page-9',
    });
  });
});
