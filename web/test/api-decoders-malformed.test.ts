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
import { isUuidV7 } from '../src/api/decoders';
import { jsonResponse } from './support/state-fixture';

const PAGE = 'https://example.com/a';
const B = '019363b8-0000-7000-8000-000000000000';
const COUNTS_OK = [{ feedId: 'f', count: 2 }];
const SETTINGS_OK = {
  retention: 100,
};
const KINDLE_OK = { kindleEmail: 'k@example.com', language: 'zh' };
const SCHEDULE_OK = { hour: 8, minute: 0, timezone: 'UTC' };
const withKindle = (kindle: unknown) => ({ ...SETTINGS_OK, kindle });
const BROWSERLESS_OK = {
  url: 'https://browserless.example.com',
  tokenConfigured: false,
  residentialProxy: false,
};
const withBrowserless = (browserless: unknown) => ({
  ...SETTINGS_OK,
  browserless,
});
const OPML_FILE = new File(['<opml/>'], 'a.opml', { type: 'text/xml' });

const spList = () => savedPagesApi.list();
const spUnread = () => savedPagesApi.unreadCount();
const spAdd = () => savedPagesApi.create(PAGE);
const fList = () => feedsApi.listItems('f1');
const dList = () => foldersApi.listItems('f1');
const fCounts = () => feedsApi.unreadCounts();
const fPrev = () => feedsApi.preview(PAGE);
const fAdd = () => feedsApi.create({ url: PAGE });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BAD_LIST = { items: 'bad', cursor: null, boundary: B };
const BAD_ITEMS = { items: [{ id: '1' }], cursor: null, boundary: B };
const BAD_PREVIEW = { preview: { url: 'u', title: 't', titles: [123] } };
const NO_B = { items: [], cursor: null };
const MALFORMED_CASES: Array<[string, () => Promise<unknown>, unknown]> = [
  ['session', () => authApi.getSession(), { authenticated: 'yes' }],
  ['saved missing cursor', spList, { items: [], boundary: B }],
  ['saved missing boundary', spList, NO_B],
  ['saved bad boundary', spList, { items: [], cursor: null, boundary: 123 }],
  ['saved invalid item', spList, BAD_ITEMS],
  ['saved count', spUnread, { count: '3', boundary: B }],
  ['saved count boundary', spUnread, { count: 3 }],
  ['saved get', () => savedPagesApi.getById('p1'), { item: { id: 'p1' } }],
  ['saved create', spAdd, { item: null }],
  ['save item', () => savedPagesApi.saveFeedItem('i1'), {}],
  ['folders', () => foldersApi.list(), { items: [{ id: 1, name: 'x' }] }],
  ['folder create', () => foldersApi.create('x'), { item: { id: '1' } }],
  ['folder items', dList, BAD_LIST],
  ['folder items boundary', dList, NO_B],
  ['feeds', () => feedsApi.list(), { items: [{ id: 'f1', url: 'u' }] }],
  ['preview', fPrev, BAD_PREVIEW],
  ['feed create', fAdd, { item: { id: 'f1' } }],
  ['counts', fCounts, { items: [{ count: '2' }], boundary: B }],
  ['counts boundary', fCounts, { items: COUNTS_OK }],
  ['feed items', fList, { items: [], cursor: 123, boundary: B }],
  ['feed items boundary', fList, { items: [], cursor: 'c1' }],
  ['opml', () => feedsApi.importOpml(OPML_FILE), { importedFeeds: 1 }],
  ['items', () => feedItemsApi.listAll(), BAD_ITEMS],
  ['items boundary', () => feedItemsApi.listAll(), NO_B],
  ['item get', () => feedItemsApi.getById('i1'), { item: 'bad' }],
  ['extract', () => feedItemsApi.extract('i1'), { item: null }],
  ['settings', () => settingsApi.get(), { retention: '100' }],
  ['settings smtp', () => settingsApi.get(), { ...SETTINGS_OK, smtp: null }],
  ['settings browserless null', () => settingsApi.get(), withBrowserless(null)],
  [
    'browserless without tokenConfigured',
    () => settingsApi.get(),
    withBrowserless({ url: BROWSERLESS_OK.url, residentialProxy: false }),
  ],
  [
    'browserless tokenConfigured type',
    () => settingsApi.get(),
    withBrowserless({ ...BROWSERLESS_OK, tokenConfigured: 'yes' }),
  ],
  [
    'browserless without residentialProxy',
    () => settingsApi.get(),
    withBrowserless({ url: BROWSERLESS_OK.url, tokenConfigured: false }),
  ],
  [
    'browserless residentialProxy type',
    () => settingsApi.get(),
    withBrowserless({ ...BROWSERLESS_OK, residentialProxy: 1 }),
  ],
  [
    'browserless without url',
    () => settingsApi.get(),
    withBrowserless({ tokenConfigured: false, residentialProxy: false }),
  ],
  [
    'browserless url type',
    () => settingsApi.get(),
    withBrowserless({ ...BROWSERLESS_OK, url: 8 }),
  ],
  [
    'kindle schedule without timezone',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, schedule: { hour: 8, minute: 0 } }),
  ],
  [
    'kindle top-level timezone only schedule',
    () => settingsApi.get(),
    withKindle({
      ...KINDLE_OK,
      timezone: 'UTC',
      schedule: { hour: 8, minute: 0 },
    }),
  ],
  [
    'kindle schedule timezone type',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, schedule: { ...SCHEDULE_OK, timezone: 8 } }),
  ],
  [
    'kindle null schedule',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, schedule: null }),
  ],
  [
    'kindle schedule without minute',
    () => settingsApi.get(),
    withKindle({
      ...KINDLE_OK,
      schedule: { hour: 8, timezone: SCHEDULE_OK.timezone },
    }),
  ],
  [
    'kindle schedule fractional hour',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, schedule: { ...SCHEDULE_OK, hour: 8.5 } }),
  ],
  [
    'kindle schedule string minute',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, schedule: { ...SCHEDULE_OK, minute: '30' } }),
  ],
  [
    'kindle nextSendAt type',
    () => settingsApi.get(),
    withKindle({ ...KINDLE_OK, nextSendAt: 12 }),
  ],
  ['kindle send', () => kindleApi.sendNow(), { item: { trigger: 'manual' } }],
  ['kindle sends', () => kindleApi.listSends(), { running: 'yes', items: [] }],
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

const V4 = '019363b8-0000-4000-8000-000000000000';
const BAD_BOUNDARIES = ['', 'abc', V4, '019363B8-0000-7000-8000-000000000000'];
const BOUNDARY_ENDPOINTS: Array<
  [() => Promise<unknown>, (b: string) => unknown]
> = [
  [spList, (boundary) => ({ items: [], cursor: null, boundary })],
  [fList, (boundary) => ({ items: [], cursor: null, boundary })],
  [fCounts, (boundary) => ({ items: COUNTS_OK, boundary })],
  [spUnread, (boundary) => ({ count: 3, boundary })],
];

describe('boundary UUIDv7 validation', () => {
  it.each([
    [B, true],
    ['019363b8-0000-7000-8000-00000000000a', true],
    ['019363b8-0000-7000-b000-000000000000', true],
    [V4, false],
    ['', false],
    ['abc', false],
    ['019363B8-0000-7000-8000-000000000000', false],
    ['019363b8-0000-7000-c000-000000000000', false],
    ['019363b8000070008000000000000000', false],
    [undefined, false],
  ])('isUuidV7(%j) is %s', (value, expected) => {
    expect(isUuidV7(value)).toBe(expected);
  });

  it.each(BAD_BOUNDARIES)(
    'rejects boundary %j on every boundary-bearing endpoint',
    async (boundary) => {
      for (const [run, body] of BOUNDARY_ENDPOINTS) {
        fetchMock.mockResolvedValueOnce(jsonResponse(body(boundary), 200));
        await expect(run()).rejects.toMatchObject({
          code: 'InvalidResponse',
          status: 200,
        });
      }
    }
  );
});
