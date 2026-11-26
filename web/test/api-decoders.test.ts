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
import {
  jsonResponse,
  makeFeed,
  makeFolder,
  makeItem,
  makePage,
} from './support/state-fixture';

const PAGE = 'https://example.com/a';
const PAGE_OK = makePage({ id: 'p', url: PAGE });
const FEED_OK = makeFeed({ id: 'f', url: PAGE });
const ITEM_OK = makeItem({ id: 'i', feedId: 'f', url: PAGE });
const EXTRACT_OK = { ...ITEM_OK, extractedContent: '<p>extracted</p>' };
const FOLDER_OK = makeFolder('f', 't');
const PREVIEW_OK = { url: PAGE, title: 'F', titles: ['Post 1'] };
const B = '019363b8-0000-7000-8000-000000000000';
const COUNTS_OK = [{ feedId: 'f', count: 2 }];
const COUNTS_RES = { items: COUNTS_OK, boundary: B };
const SAVED_COUNT_RES = { count: 4, boundary: B };
const SAVED_PAGE = { items: [PAGE_OK], cursor: null, boundary: B };
const ITEM_PAGE = { items: [ITEM_OK], cursor: 'i', boundary: B };
const SETTINGS_OK = {
  retention: 100,
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};
const SEND_OK = {
  id: 's',
  trigger: 'manual',
  status: 'running',
  startedAt: '2026-11-24T00:00:00Z',
  articleCount: 0,
  bookCount: 0,
};
const SENDS_OK = { running: true, items: [SEND_OK] };
const OPML_FILE = new File(['<opml/>'], 'a.opml', { type: 'text/xml' });

type UnwrapCase = [string, () => Promise<unknown>, unknown, unknown, number?];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spList = () => savedPagesApi.list();
const spUnread = () => savedPagesApi.unreadCount();
const spAdd = () => savedPagesApi.create(PAGE);
const fCounts = () => feedsApi.unreadCounts();
const fPrev = () => feedsApi.preview(PAGE);
const fAdd = () => feedsApi.create({ url: PAGE });
const fExt = () => feedItemsApi.extract('i');
const foAdd = () => foldersApi.create('t');

const UNWRAP_CASES: Array<UnwrapCase> = [
  ['saved list', spList, SAVED_PAGE, SAVED_PAGE],
  ['saved unread', spUnread, SAVED_COUNT_RES, SAVED_COUNT_RES],
  ['saved get', () => savedPagesApi.getById('p'), { item: PAGE_OK }, PAGE_OK],
  ['saved add', spAdd, { item: PAGE_OK }, PAGE_OK, 201],
  ['feeds', () => feedsApi.list(), { items: [FEED_OK] }, [FEED_OK]],
  ['feed prev', fPrev, { preview: PREVIEW_OK }, PREVIEW_OK],
  ['feed add', fAdd, { item: FEED_OK }, FEED_OK, 201],
  ['counts', fCounts, COUNTS_RES, COUNTS_RES],
  ['feed items', () => feedsApi.listItems('f'), ITEM_PAGE, ITEM_PAGE],
  ['folder items', () => foldersApi.listItems('f'), ITEM_PAGE, ITEM_PAGE],
  ['items', () => feedItemsApi.listAll(), ITEM_PAGE, ITEM_PAGE],
  ['extract', fExt, { item: EXTRACT_OK }, EXTRACT_OK],
  ['folders', () => foldersApi.list(), { items: [FOLDER_OK] }, [FOLDER_OK]],
  ['folder add', foAdd, { item: FOLDER_OK }, FOLDER_OK, 201],
  ['settings', () => settingsApi.get(), SETTINGS_OK, SETTINGS_OK],
  ['kindle send', () => kindleApi.sendNow(), { item: SEND_OK }, SEND_OK, 202],
  ['kindle sends', () => kindleApi.listSends(), SENDS_OK, SENDS_OK],
];

describe('response unwrapping', () => {
  it.each(UNWRAP_CASES)(
    'unwraps %s',
    async (_, run, body, expected, status = 200) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
      await expect(run()).resolves.toEqual(expected);
    }
  );

  it('imports OPML from a file', async () => {
    const result = { importedFeeds: 2, skippedFeeds: 1, createdFolders: 1 };
    fetchMock.mockResolvedValueOnce(jsonResponse(result));
    await expect(feedsApi.importOpml(OPML_FILE)).resolves.toEqual(result);

    const [call] = fetchMock.mock.calls;
    const init = (call?.[1] ?? {}) as RequestInit;
    expect([String(call?.[0]), init.method]).toEqual(['/api/opml', 'POST']);
    expect((init.body as FormData).get('file')).toBe(OPML_FILE);
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

describe('URL and extraction validation', () => {
  it('rejects invalid port URL across endpoints', async () => {
    const url = 'http://127.0.0.1:99999/x';
    for (const [run, body] of [
      [() => feedsApi.list(), { items: [{ ...FEED_OK, url }] }],
      [
        () => feedsApi.preview(PAGE),
        { preview: { url, title: 'F', titles: [] } },
      ],
      [() => feedItemsApi.getById('i'), { item: { ...ITEM_OK, url } }],
      [() => savedPagesApi.getById('p'), { item: { ...PAGE_OK, url } }],
    ] as Array<[() => Promise<unknown>, unknown]>) {
      fetchMock.mockResolvedValueOnce(jsonResponse(body));
      await expect(run()).rejects.toMatchObject({ code: 'InvalidResponse' });
    }
  });

  it('accepts scoped IPv6 URLs and keeps the rest of the list', async () => {
    const scoped = 'http://[fe80::1%25eth0]:8080/feed.xml';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { ...FEED_OK, id: 'a', url: scoped },
          { ...FEED_OK, id: 'b', url: 'https://example.com/rss' },
        ],
      })
    );
    const result = await feedsApi.list();
    expect(result.map((item) => item.url)).toEqual([
      scoped,
      'https://example.com/rss',
    ]);
  });

  it.each([undefined, '', '   '])(
    'rejects extraction without content %s',
    async (extractedContent) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ item: { ...ITEM_OK, extractedContent } })
      );
      await expect(feedItemsApi.extract('i')).rejects.toMatchObject({
        code: 'InvalidResponse',
      });
    }
  );
});

describe('Kindle record validation', () => {
  it.each([
    { id: '' },
    { articleCount: undefined },
    { bookCount: undefined },
    { startedAt: '2026-11-24' },
    { startedAt: 'Nov 24 2026 00:00:00 UTC' },
    { finishedAt: 'yesterday' },
  ])('rejects invalid Kindle record %o', async (patch) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ running: false, items: [{ ...SEND_OK, ...patch }] })
    );
    await expect(kindleApi.listSends()).rejects.toMatchObject({
      code: 'InvalidResponse',
    });
  });

  it('accepts RFC3339 Kindle timestamps with offsets and fractions', async () => {
    const item = {
      ...SEND_OK,
      startedAt: '2026-11-24T08:00:00.5+08:00',
      finishedAt: '2026-11-24T00:00:01Z',
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ running: false, items: [item] })
    );
    await expect(kindleApi.listSends()).resolves.toMatchObject({
      items: [item],
    });
  });
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
