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
import type { KindleSettings, SmtpSettingsInput } from '../src/api/types';
import { jsonResponse } from './support/state-fixture';

const SAVED = '/api/saved-pages';
const FEEDS = '/api/feeds';
const ITEMS = '/api/feed-items';
const FOLDERS = '/api/folders';
const S = '/api/settings';
const P = `${S}/services`;
const PAGE = 'https://example.com/a';
const LIST_URL = `${SAVED}?limit=30&unread=true&cursor=abc`;
const PARAMS = { limit: 30, unread: true, cursor: 'abc' };
const SMTP_IN: SmtpSettingsInput = {
  senderEmail: 'a@b.c',
  host: 'h',
  port: 465,
  security: 'tls',
};
const KD_IN: KindleSettings = { kindleEmail: 'k@example.com' };
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
const VALID_ITEM = { id: 'i', feedId: 'f', url: PAGE, title: 'I', read: false };
const VALID_SEND = {
  id: 's',
  trigger: 'manual',
  status: 'running',
  startedAt: '2026-11-24T00:00:00Z',
  articleCount: 0,
  bookCount: 0,
};

const SHAPE_RESPONSES: Record<string, unknown> = {
  'GET /api/auth/session': { authenticated: true },
  [`GET ${LIST_URL}`]: { items: [], cursor: null },
  [`GET ${SAVED}/unread-count`]: { count: 0 },
  [`GET ${SAVED}/p%2F1`]: { item: null },
  [`POST ${SAVED}`]: { item: VALID_PAGE },
  [`POST ${ITEMS}/i/save`]: { item: VALID_PAGE },
  [`GET ${FEEDS}`]: { items: [] },
  [`POST ${FEEDS}/preview`]: {
    preview: { url: PAGE, title: 'F', titles: ['Post 1'] },
  },
  [`POST ${FEEDS}`]: { item: VALID_FEED },
  [`GET ${FEEDS}/unread-counts`]: { items: [] },
  [`GET ${FEEDS}/f/items?limit=10&unread=false`]: { items: [], cursor: null },
  [`GET ${ITEMS}`]: { items: [], cursor: null },
  [`POST ${ITEMS}/i/extract`]: {
    item: { ...VALID_ITEM, extractedContent: '<p>extracted</p>' },
  },
  [`GET ${FOLDERS}`]: { items: [] },
  [`POST ${FOLDERS}`]: { item: { id: 'f', name: 't' } },
  [`GET ${FOLDERS}/f/items?unread=true`]: { items: [], cursor: null },
  [`GET ${S}`]: {
    retention: 100,
    provider: 'direct',
    jinaKeyConfigured: false,
    browserEndpointConfigured: false,
  },
  'POST /api/kindle/send': { item: VALID_SEND },
  'GET /api/kindle/sends': { running: false, items: [] },
};

type Shape = [string, () => Promise<unknown>, string, string, unknown?];

let fetchMock: ReturnType<typeof vi.fn>;

const recorded = () =>
  fetchMock.mock.calls.map(([url, init]) => {
    const { body, method } = (init ?? {}) as RequestInit;
    const head = [String(url), String(method)];
    if (typeof body !== 'string') return body == null ? head : [...head, body];
    return body.startsWith('{') ? [...head, JSON.parse(body)] : [...head, body];
  });

beforeEach(() => {
  fetchMock = vi
    .fn()
    .mockImplementation((input: unknown, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input)}`;
      return key in SHAPE_RESPONSES
        ? jsonResponse(SHAPE_RESPONSES[key])
        : new Response(null, {
            status: key === 'POST /api/feeds/f/refresh' ? 202 : 204,
          });
    });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SHAPES: Array<Shape> = [
  ['session', () => authApi.getSession(), '/api/auth/session', 'GET'],
  [
    'login',
    () => authApi.login('pw'),
    '/api/auth/login',
    'POST',
    { password: 'pw' },
  ],
  ['logout', () => authApi.logout(), '/api/auth/logout', 'POST'],
  ['list', () => savedPagesApi.list(PARAMS), LIST_URL, 'GET'],
  ['count', () => savedPagesApi.unreadCount(), `${SAVED}/unread-count`, 'GET'],
  ['page', () => savedPagesApi.getById('p/1'), `${SAVED}/p%2F1`, 'GET'],
  ['add', () => savedPagesApi.create(PAGE), SAVED, 'POST', { url: PAGE }],
  ['save', () => savedPagesApi.saveFeedItem('i'), `${ITEMS}/i/save`, 'POST'],
  [
    'read',
    () => savedPagesApi.setRead('p', true),
    `${SAVED}/p`,
    'PATCH',
    { read: true },
  ],
  [
    'ids',
    () => savedPagesApi.markIdsRead(['a']),
    `${SAVED}/read`,
    'POST',
    { ids: ['a'] },
  ],
  ['all read', () => savedPagesApi.markAllRead(), `${SAVED}/read-all`, 'POST'],
  ['drop', () => savedPagesApi.remove('p'), `${SAVED}/p`, 'DELETE'],
  ['feeds', () => feedsApi.list(), FEEDS, 'GET'],
  [
    'preview',
    () => feedsApi.preview(PAGE),
    `${FEEDS}/preview`,
    'POST',
    { url: PAGE },
  ],
  [
    'add feed',
    () => feedsApi.create({ url: PAGE }),
    FEEDS,
    'POST',
    { url: PAGE },
  ],
  ['refresh', () => feedsApi.refresh('f'), `${FEEDS}/f/refresh`, 'POST'],
  [
    'reader mode',
    () => feedsApi.setReaderMode('f', 'extracted'),
    `${FEEDS}/f/reader-mode`,
    'PUT',
    { readerMode: 'extracted' },
  ],
  [
    'feed order',
    () => feedsApi.setOrder('f', 'oldest'),
    `${FEEDS}/f/order`,
    'PUT',
    { order: 'oldest' },
  ],
  [
    'move feed',
    () => feedsApi.moveToFolder('f', null),
    `${FEEDS}/f`,
    'PATCH',
    { folderId: null },
  ],
  ['feed read', () => feedsApi.markAllRead('f'), `${FEEDS}/f/read-all`, 'POST'],
  ['feed drop', () => feedsApi.remove('f'), `${FEEDS}/f`, 'DELETE'],
  ['unread', () => feedsApi.unreadCounts(), `${FEEDS}/unread-counts`, 'GET'],
  [
    'feed items',
    () => feedsApi.listItems('f', { limit: 10, unread: false }),
    `${FEEDS}/f/items?limit=10&unread=false`,
    'GET',
  ],
  ['items', () => feedItemsApi.listAll(), ITEMS, 'GET'],
  ['extract', () => feedItemsApi.extract('i'), `${ITEMS}/i/extract`, 'POST'],
  [
    'item',
    () => feedItemsApi.setRead('i', true),
    `${ITEMS}/i`,
    'PATCH',
    { read: true },
  ],
  [
    'item ids',
    () => feedItemsApi.markIdsRead(['a']),
    `${ITEMS}/read`,
    'POST',
    { ids: ['a'] },
  ],
  ['item all', () => feedItemsApi.markAllRead(), `${ITEMS}/read-all`, 'POST'],
  ['folders', () => foldersApi.list(), FOLDERS, 'GET'],
  ['new folder', () => foldersApi.create('t'), FOLDERS, 'POST', { name: 't' }],
  [
    'rename',
    () => foldersApi.rename('f', 't'),
    `${FOLDERS}/f`,
    'PATCH',
    { name: 't' },
  ],
  ['folder drop', () => foldersApi.remove('f'), `${FOLDERS}/f`, 'DELETE'],
  [
    'folder items',
    () => foldersApi.listItems('f', { unread: true }),
    `${FOLDERS}/f/items?unread=true`,
    'GET',
  ],
  ['settings', () => settingsApi.get(), S, 'GET'],
  [
    'keep',
    () => settingsApi.updateRetention(5),
    `${S}/retention`,
    'PUT',
    { retention: 5 },
  ],
  [
    'prov',
    () => settingsApi.updateProvider('jina'),
    `${S}/provider`,
    'PUT',
    { provider: 'jina' },
  ],
  [
    'save jina',
    () => settingsApi.saveJinaKey('k'),
    `${P}/jina`,
    'PUT',
    { key: 'k' },
  ],
  ['del jina', () => settingsApi.deleteJinaKey(), `${P}/jina`, 'DELETE'],
  [
    'cdp',
    () => settingsApi.saveBrowserEndpoint('http://browser:9222'),
    `${P}/browser`,
    'PUT',
    { endpoint: 'http://browser:9222' },
  ],
  [
    'del cdp',
    () => settingsApi.deleteBrowserEndpoint(),
    `${P}/browser`,
    'DELETE',
  ],
  [
    'save smtp',
    () => settingsApi.saveSmtp(SMTP_IN),
    `${P}/smtp`,
    'PUT',
    SMTP_IN,
  ],
  ['del smtp', () => settingsApi.deleteSmtp(), `${P}/smtp`, 'DELETE'],
  [
    'del pw',
    () => settingsApi.deleteSmtpPassword(),
    `${P}/smtp/password`,
    'DELETE',
  ],
  [
    'kindle',
    () => settingsApi.updateKindle(KD_IN),
    `${S}/kindle`,
    'PUT',
    KD_IN,
  ],
  ['send', () => kindleApi.sendNow(), '/api/kindle/send', 'POST'],
  ['sends', () => kindleApi.listSends(), '/api/kindle/sends', 'GET'],
];

describe('request shapes', () => {
  for (const [name, run, url, method, body] of SHAPES) {
    it(name, async () => {
      await run();
      expect(recorded()).toEqual([
        body === undefined ? [url, method] : [url, method, body],
      ]);
    });
  }
});
