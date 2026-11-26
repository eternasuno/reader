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
const B = '019363b8-0000-7000-8000-000000000000';
const BEFORE = { before: B };
const CONT = { cursor: 'c1', boundary: B };
const CQ = `cursor=c1&boundary=${B}`;
const LIST_URL = `${SAVED}?limit=30&unread=true&cursor=abc&boundary=${B}`;
const PARAMS = { limit: 30, unread: true, cursor: 'abc', boundary: B };
const FIRST_PARAMS = { limit: 30, unread: true, cursor: null, boundary: B };
const EMPTY_PAGE = { items: [], cursor: null, boundary: B };
const sp = savedPagesApi;
const fa = feedsApi;
const fi = feedItemsApi;
const fo = foldersApi;
const st = settingsApi;
const SMTP_IN: SmtpSettingsInput = {
  senderEmail: 'a@b.c',
  host: 'h',
  port: 465,
  security: 'tls',
};
const KD_IN: KindleSettings = {
  kindleEmail: 'k@example.com',
  schedule: { hour: 8, minute: 30, timezone: 'Asia/Shanghai' },
};
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
  [`GET ${LIST_URL}`]: EMPTY_PAGE,
  [`GET ${SAVED}?limit=30&unread=true`]: EMPTY_PAGE,
  [`GET ${SAVED}/unread-count`]: { count: 0, boundary: B },
  [`GET ${SAVED}/p%2F1`]: { item: null },
  [`POST ${SAVED}`]: { item: VALID_PAGE },
  [`POST ${ITEMS}/i/save`]: { item: VALID_PAGE },
  [`GET ${FEEDS}`]: { items: [] },
  [`POST ${FEEDS}/preview`]: {
    preview: { url: PAGE, title: 'F', titles: ['Post 1'] },
  },
  [`POST ${FEEDS}`]: { item: VALID_FEED },
  [`GET ${FEEDS}/unread-counts`]: { items: [], boundary: B },
  [`GET ${FEEDS}/f/items?limit=10&unread=false`]: EMPTY_PAGE,
  [`GET ${FEEDS}/f/items?${CQ}`]: EMPTY_PAGE,
  [`GET ${ITEMS}`]: EMPTY_PAGE,
  [`GET ${ITEMS}?${CQ}`]: EMPTY_PAGE,
  [`POST ${ITEMS}/i/extract`]: {
    item: { ...VALID_ITEM, extractedContent: '<p>extracted</p>' },
  },
  [`GET ${FOLDERS}`]: { items: [] },
  [`POST ${FOLDERS}`]: { item: { id: 'f', name: 't' } },
  [`GET ${FOLDERS}/f/items?unread=true`]: EMPTY_PAGE,
  [`GET ${FOLDERS}/f/items?${CQ}`]: EMPTY_PAGE,
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
  ['list', () => sp.list(PARAMS), LIST_URL, 'GET'],
  [
    'list first',
    () => sp.list(FIRST_PARAMS),
    `${SAVED}?limit=30&unread=true`,
    'GET',
  ],
  ['count', () => sp.unreadCount(), `${SAVED}/unread-count`, 'GET'],
  ['page', () => sp.getById('p/1'), `${SAVED}/p%2F1`, 'GET'],
  ['add', () => sp.create(PAGE), SAVED, 'POST', { url: PAGE }],
  ['save', () => sp.saveFeedItem('i'), `${ITEMS}/i/save`, 'POST'],
  ['read', () => sp.setRead('p', true), `${SAVED}/p`, 'PATCH', { read: true }],
  ['ids', () => sp.markIdsRead(['a']), `${SAVED}/read`, 'POST', { ids: ['a'] }],
  ['all read', () => sp.markAllRead(B), `${SAVED}/read-all`, 'POST', BEFORE],
  ['drop', () => sp.remove('p'), `${SAVED}/p`, 'DELETE'],
  ['feeds', () => fa.list(), FEEDS, 'GET'],
  [
    'preview',
    () => fa.preview(PAGE),
    `${FEEDS}/preview`,
    'POST',
    { url: PAGE },
  ],
  ['add feed', () => fa.create({ url: PAGE }), FEEDS, 'POST', { url: PAGE }],
  ['refresh', () => fa.refresh('f'), `${FEEDS}/f/refresh`, 'POST'],
  [
    'mode',
    () => fa.setReaderMode('f', 'extracted'),
    `${FEEDS}/f/reader-mode`,
    'PUT',
    { readerMode: 'extracted' },
  ],
  [
    'order',
    () => fa.setOrder('f', 'oldest'),
    `${FEEDS}/f/order`,
    'PUT',
    { order: 'oldest' },
  ],
  [
    'move',
    () => fa.moveToFolder('f', null),
    `${FEEDS}/f`,
    'PATCH',
    { folderId: null },
  ],
  [
    'feed read',
    () => fa.markAllRead('f', B),
    `${FEEDS}/f/read-all`,
    'POST',
    BEFORE,
  ],
  ['feed drop', () => fa.remove('f'), `${FEEDS}/f`, 'DELETE'],
  ['unread', () => fa.unreadCounts(), `${FEEDS}/unread-counts`, 'GET'],
  [
    'feed items',
    () => fa.listItems('f', { limit: 10, unread: false }),
    `${FEEDS}/f/items?limit=10&unread=false`,
    'GET',
  ],
  ['feed cont', () => fa.listItems('f', CONT), `${FEEDS}/f/items?${CQ}`, 'GET'],
  ['items', () => fi.listAll(), ITEMS, 'GET'],
  ['items cont', () => fi.listAll(CONT), `${ITEMS}?${CQ}`, 'GET'],
  ['extract', () => fi.extract('i'), `${ITEMS}/i/extract`, 'POST'],
  ['item', () => fi.setRead('i', true), `${ITEMS}/i`, 'PATCH', { read: true }],
  [
    'item ids',
    () => fi.markIdsRead(['a']),
    `${ITEMS}/read`,
    'POST',
    { ids: ['a'] },
  ],
  ['item all', () => fi.markAllRead(B), `${ITEMS}/read-all`, 'POST', BEFORE],
  ['folders', () => fo.list(), FOLDERS, 'GET'],
  ['new folder', () => fo.create('t'), FOLDERS, 'POST', { name: 't' }],
  ['rename', () => fo.rename('f', 't'), `${FOLDERS}/f`, 'PATCH', { name: 't' }],
  ['folder drop', () => fo.remove('f'), `${FOLDERS}/f`, 'DELETE'],
  [
    'folder read',
    () => fo.markAllRead('f', B),
    `${FOLDERS}/f/read-all`,
    'POST',
    BEFORE,
  ],
  [
    'folder items',
    () => fo.listItems('f', { unread: true }),
    `${FOLDERS}/f/items?unread=true`,
    'GET',
  ],
  [
    'folder cont',
    () => fo.listItems('f', CONT),
    `${FOLDERS}/f/items?${CQ}`,
    'GET',
  ],
  ['settings', () => st.get(), S, 'GET'],
  [
    'keep',
    () => st.updateRetention(5),
    `${S}/retention`,
    'PUT',
    { retention: 5 },
  ],
  [
    'prov',
    () => st.updateProvider('jina'),
    `${S}/provider`,
    'PUT',
    { provider: 'jina' },
  ],
  ['save jina', () => st.saveJinaKey('k'), `${P}/jina`, 'PUT', { key: 'k' }],
  ['del jina', () => st.deleteJinaKey(), `${P}/jina`, 'DELETE'],
  [
    'cdp',
    () => st.saveBrowserEndpoint('http://browser:9222'),
    `${P}/browser`,
    'PUT',
    { endpoint: 'http://browser:9222' },
  ],
  ['del cdp', () => st.deleteBrowserEndpoint(), `${P}/browser`, 'DELETE'],
  ['save smtp', () => st.saveSmtp(SMTP_IN), `${P}/smtp`, 'PUT', SMTP_IN],
  ['del smtp', () => st.deleteSmtp(), `${P}/smtp`, 'DELETE'],
  ['del pw', () => st.deleteSmtpPassword(), `${P}/smtp/password`, 'DELETE'],
  ['kindle', () => st.updateKindle(KD_IN), `${S}/kindle`, 'PUT', KD_IN],
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
