import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  authApi,
  feedItemsApi,
  feedsApi,
  foldersApi,
  kindleApi,
  onUnauthorized,
  savedPagesApi,
  settingsApi,
} from '../src/api';
import type { KindleSettings, SmtpSettingsInput } from '../src/api/types';
import { setLocale, translateErrorCode } from '../src/i18n';

const SAVED = '/api/saved-pages';
const FEEDS = '/api/feeds';
const ITEMS = '/api/feed-items';
const FOLDERS = '/api/folders';
const S = '/api/settings';
const P = `${S}/services`;
const api = settingsApi;
const JINA = { key: 'k' };
const CDP = 'http://browser:9222';
const CDP_B = { endpoint: CDP };
const PROV = { provider: 'jina' };
const SMTP_IN: SmtpSettingsInput = {
  senderEmail: 'a@b.c',
  host: 'h',
  port: 465,
  security: 'tls',
};
const KD_IN: KindleSettings = { kindleEmail: 'k@example.com' };
const PAGE = 'https://example.com/a';
const PARAMS = { limit: 30, unread: true, cursor: 'abc' };
const LIST_URL = `${SAVED}?limit=30&unread=true&cursor=abc`;
const LOOKUP = `${SAVED}/lookup?url=${encodeURIComponent(PAGE)}`;
const PREV_U = `${FEEDS}/preview`;
const READ_U = `${ITEMS}/read`;
const URL_BODY = { url: PAGE };
const READ = { read: true };
const LOGIN = { password: 'pw' };
const IDS = { ids: ['a'] };
const KEEP = { retention: 5 };
const NAME = { name: 't' };

type Call = Array<unknown>;
type Shape = [string, () => Promise<unknown>, string, string, unknown?];

let fetchMock: ReturnType<typeof vi.fn>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const recorded = (): Array<Call> =>
  fetchMock.mock.calls.map(([url, init]) => {
    const { body, method } = (init ?? {}) as RequestInit;
    const head = [String(url), String(method)];
    if (typeof body !== 'string') return body == null ? head : [...head, body];
    return body.startsWith('{') ? [...head, JSON.parse(body)] : [...head, body];
  });

const expectCalls = (calls: Array<Call>) => expect(recorded()).toEqual(calls);

const requestInit = (call: number): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

const requestUrl = (call: number): string =>
  String(fetchMock.mock.calls[call]?.[0]);

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(() => jsonResponse({}));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  setLocale('zh-CN');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SHAPES: Array<Shape> = [
  ['session', () => authApi.getSession(), '/api/auth/session', 'GET'],
  ['login', () => authApi.login('pw'), '/api/auth/login', 'POST', LOGIN],
  ['logout', () => authApi.logout(), '/api/auth/logout', 'POST'],
  ['list', () => savedPagesApi.list(PARAMS), LIST_URL, 'GET'],
  ['count', () => savedPagesApi.unreadCount(), `${SAVED}/unread-count`, 'GET'],
  ['lookup', () => savedPagesApi.lookup(PAGE), LOOKUP, 'GET'],
  ['page', () => savedPagesApi.getById('p/1'), `${SAVED}/p%2F1`, 'GET'],
  ['add', () => savedPagesApi.create(PAGE), SAVED, 'POST', URL_BODY],
  ['save', () => savedPagesApi.saveFeedItem('i'), `${ITEMS}/i/save`, 'POST'],
  ['read', () => savedPagesApi.setRead('p', true), `${SAVED}/p`, 'PATCH', READ],
  ['ids', () => savedPagesApi.markIdsRead(['a']), `${SAVED}/read`, 'POST', IDS],
  ['all read', () => savedPagesApi.markAllRead(), `${SAVED}/read-all`, 'POST'],
  ['drop', () => savedPagesApi.remove('p'), `${SAVED}/p`, 'DELETE'],
  ['feeds', () => feedsApi.list(), FEEDS, 'GET'],
  ['preview', () => feedsApi.preview(PAGE), PREV_U, 'POST', URL_BODY],
  ['add feed', () => feedsApi.create(URL_BODY), FEEDS, 'POST', URL_BODY],
  ['refresh', () => feedsApi.refresh('f'), `${FEEDS}/f/refresh`, 'POST'],
  ['feed read', () => feedsApi.markAllRead('f'), `${FEEDS}/f/read-all`, 'POST'],
  ['feed drop', () => feedsApi.remove('f'), `${FEEDS}/f`, 'DELETE'],
  ['unread', () => feedsApi.unreadCounts(), `${FEEDS}/unread-counts`, 'GET'],
  ['items', () => feedItemsApi.listAll(), ITEMS, 'GET'],
  ['extract', () => feedItemsApi.extract('i'), `${ITEMS}/i/extract`, 'POST'],
  ['item', () => feedItemsApi.setRead('i', true), `${ITEMS}/i`, 'PATCH', READ],
  ['item ids', () => feedItemsApi.markIdsRead(['a']), READ_U, 'POST', IDS],
  ['item all', () => feedItemsApi.markAllRead(), `${ITEMS}/read-all`, 'POST'],
  ['folders', () => foldersApi.list(), FOLDERS, 'GET'],
  ['new folder', () => foldersApi.create('t'), FOLDERS, 'POST', NAME],
  ['rename', () => foldersApi.rename('f', 't'), `${FOLDERS}/f`, 'PATCH', NAME],
  ['folder drop', () => foldersApi.remove('f'), `${FOLDERS}/f`, 'DELETE'],
  ['settings', () => api.get(), S, 'GET'],
  ['keep', () => api.updateRetention(5), `${S}/retention`, 'PUT', KEEP],
  ['prov', () => api.updateProvider('jina'), `${S}/provider`, 'PUT', PROV],
  ['save jina', () => api.saveJinaKey('k'), `${P}/jina`, 'PUT', JINA],
  ['del jina', () => api.deleteJinaKey(), `${P}/jina`, 'DELETE'],
  ['cdp', () => api.saveBrowserEndpoint(CDP), `${P}/browser`, 'PUT', CDP_B],
  ['del cdp', () => api.deleteBrowserEndpoint(), `${P}/browser`, 'DELETE'],
  ['save smtp', () => api.saveSmtp(SMTP_IN), `${P}/smtp`, 'PUT', SMTP_IN],
  ['del smtp', () => api.deleteSmtp(), `${P}/smtp`, 'DELETE'],
  ['del pw', () => api.deleteSmtpPassword(), `${P}/smtp/password`, 'DELETE'],
  ['kindle', () => api.updateKindle(KD_IN), `${S}/kindle`, 'PUT', KD_IN],
  ['send', () => kindleApi.sendNow(), '/api/kindle/send', 'POST'],
  ['sends', () => kindleApi.listSends(), '/api/kindle/sends', 'GET'],
  ['opml', () => feedsApi.importOpml('<o/>'), '/api/opml', 'POST', '<o/>'],
];

describe('request shapes', () => {
  for (const [name, run, url, method, body] of SHAPES) {
    it(name, async () => {
      await run();
      expectCalls([body === undefined ? [url, method] : [url, method, body]]);
    });
  }
});

describe('saved pages responses', () => {
  const page = { id: 'p', url: PAGE, read: false };

  it('unwraps counts, lookups, pages, and creates', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 4 }));
    await expect(savedPagesApi.unreadCount()).resolves.toBe(4);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: page }));
    await expect(savedPagesApi.lookup(PAGE)).resolves.toEqual(page);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: page }));
    await expect(savedPagesApi.getById('p')).resolves.toEqual(page);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: page }, 201));
    await expect(savedPagesApi.create(PAGE)).resolves.toEqual(page);
    expect(requestUrl(1)).toContain(`url=${encodeURIComponent(PAGE)}`);
  });
});

describe('feeds responses', () => {
  const feed = { id: 'f', url: PAGE };

  it('unwraps list, preview, and create payloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [feed] }));
    await expect(feedsApi.list()).resolves.toEqual([feed]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ preview: feed }));
    await expect(feedsApi.preview(PAGE)).resolves.toEqual(feed);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: feed }, 201));
    await expect(feedsApi.create(URL_BODY)).resolves.toEqual(feed);
    expect(feedsApi.exportOpmlUrl).toBe('/api/opml');
  });

  it('serializes item params and reads unread counts', async () => {
    await feedsApi.listItems('f', { limit: 10, unread: false });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ feedId: 'f', count: 2 }] })
    );
    await expect(feedsApi.unreadCounts()).resolves.toEqual([
      { feedId: 'f', count: 2 },
    ]);
    expect(requestUrl(0)).toBe(`${FEEDS}/f/items?limit=10&unread=false`);
  });
});

describe('feeds writes', () => {
  it('sends preferences, order, and folder moves', async () => {
    await feedsApi.setReaderMode('f', 'extracted');
    await feedsApi.setOrder('f', 'oldest');
    await feedsApi.moveToFolder('f', null);
    expectCalls([
      [`${FEEDS}/f/reader-mode`, 'PUT', { readerMode: 'extracted' }],
      [`${FEEDS}/f/order`, 'PUT', { order: 'oldest' }],
      [`${FEEDS}/f`, 'PATCH', { folderId: null }],
    ]);
  });

  it('imports OPML from a string and a file', async () => {
    const result = { importedFeeds: 2, skippedFeeds: 1, createdFolders: 1 };
    const file = new File(['<opml/>'], 'a.opml', { type: 'text/xml' });
    fetchMock.mockImplementation(() => jsonResponse(result));
    await expect(feedsApi.importOpml('<opml/>')).resolves.toEqual(result);
    await expect(feedsApi.importOpml(file)).resolves.toEqual(result);
    const headers = requestInit(0).headers as Record<string, string>;
    expect([requestInit(0).body, headers['Content-Type']]).toEqual([
      '<opml/>',
      'application/xml',
    ]);
    expect((requestInit(1).body as FormData).get('file')).toBe(file);
  });
});

describe('feed items and folders', () => {
  it('unwraps feed item pages and extraction', async () => {
    const item = { id: 'i', feedId: 'f', read: false };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [item], cursor: 'i' })
    );
    await expect(feedItemsApi.listAll()).resolves.toEqual({
      items: [item],
      cursor: 'i',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ item }));
    await expect(feedItemsApi.extract('i')).resolves.toEqual(item);
  });

  it('unwraps folders and sends folder writes', async () => {
    const folder = { id: 'f', name: 't' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [folder] }));
    await expect(foldersApi.list()).resolves.toEqual([folder]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: folder }, 201));
    await expect(foldersApi.create('t')).resolves.toEqual(folder);
    await foldersApi.listItems('f', { unread: true });
    expect(requestUrl(2)).toBe(`${FOLDERS}/f/items?unread=true`);
  });
});

describe('settings and kindle', () => {
  it('unwraps settings and sends provider, service and kindle bodies', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ retention: 100 }));
    await expect(settingsApi.get()).resolves.toMatchObject({ retention: 100 });
    await settingsApi.updateRetention(5);
    await settingsApi.updateProvider('jina');
    await settingsApi.saveJinaKey('k');
    await settingsApi.saveBrowserEndpoint(CDP);
    await settingsApi.saveSmtp(SMTP_IN);
    await settingsApi.updateKindle(KD_IN);
    const bodies = recorded()
      .slice(1)
      .map((call) => call[2]);
    expect(bodies).toEqual([KEEP, PROV, JINA, CDP_B, SMTP_IN, KD_IN]);
  });

  it('unwraps kindle sends', async () => {
    const record = { id: 's', trigger: 'manual', status: 'running' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: record }, 202));
    await expect(kindleApi.sendNow()).resolves.toEqual(record);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ running: true, items: [record] })
    );
    await expect(kindleApi.listSends()).resolves.toEqual({
      running: true,
      items: [record],
    });
  });
});

describe('401 handling', () => {
  it('keeps login 401 as InvalidCredentials', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(authApi.login('wrong')).rejects.toMatchObject({
      code: 'InvalidCredentials',
      status: 401,
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies other 401s and stops after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(feedsApi.list()).rejects.toBeInstanceOf(ApiError);
    unsubscribe();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(feedsApi.list()).rejects.toMatchObject({
      code: 'Unauthorized',
      status: 401,
    });
    expect(listener).toHaveBeenCalledTimes(1);
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

  it('keeps backend codes and conflict URLs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'FeedAlreadyExists', url: PAGE }, 409)
    );
    await expect(feedsApi.create(URL_BODY)).rejects.toMatchObject({
      code: 'FeedAlreadyExists',
      url: PAGE,
    });
    expect(translateErrorCode('FeedAlreadyExists')).toBe('该订阅已存在');
  });
});
