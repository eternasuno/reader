import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse as json,
  makeFeed,
  makeItem,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';

const context = createStateTestContext();
const {
  queue,
  queueEmpty,
  pending,
  requestUrl,
  requestInit,
  fetchCount,
  queueLoadedLibrary,
} = context;
let state: typeof context.state;
let solid: typeof context.solid;
let i18n: typeof context.i18n;
let ui: typeof context.ui;
let releaseMount: () => void = () => {};

const unmountLibrary = (): void => {
  releaseMount();
  releaseMount = () => {};
};

beforeEach(async () => {
  await context.reset();
  ({ state, solid, i18n, ui } = context);
  releaseMount = state.trackLibraryMount();
});

afterEach(unmountLibrary);

describe('unsubscribeFeed reload', () => {
  it('reloads page 1 of an active aggregate scope after deleting a feed', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      cursor: 'iB1',
      feeds: [feedA, feedB],
    });

    const before = fetchCount();
    queueEmpty();
    queue({
      items: [
        makeItem({ id: 'iB1', feedId: 'fB' }),
        makeItem({ id: 'iB2', feedId: 'fB' }),
      ],
      cursor: null,
      boundary: B,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 2);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe('/api/feeds/fA');
    expect(requestUrl(before + 1)).toBe(
      '/api/feed-items?limit=30&unread=false'
    );
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fB']);
    expect(state.rows().map((row) => row.id)).toEqual(['iB1', 'iB2']);
    expect(state.cursor()).toBeNull();
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed unmounted', () => {
  it('skips the page-1 reload when unmounted', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      cursor: 'iB1',
      feeds: [feedA, feedB],
    });

    unmountLibrary();
    const before = fetchCount();
    queueEmpty();
    queue({
      items: [makeItem({ id: 'iB1', feedId: 'fB' })],
      cursor: null,
      boundary: B,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe('/api/feeds/fA');
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fB']);
    expect(state.rows().map((row) => row.id)).toEqual(['iA1', 'iB1']);
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed stale page discard', () => {
  it('discards an in-flight page response requested before the delete', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      cursor: 'iA1',
      feeds: [feedA, feedB],
    });

    const latePage = pending();
    const pendingNext = state.loadNextPage();

    queueEmpty();
    queue({
      items: [makeItem({ id: 'iB1', feedId: 'fB' })],
      cursor: null,
      boundary: B,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    latePage.resolve(
      json({
        items: [makeItem({ id: 'iA2', feedId: 'fA' })],
        cursor: 'iA2',
        boundary: B,
      })
    );
    await pendingNext;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['iB1']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingMore()).toBe(false);
  });
});

describe('unsubscribeFeed failure', () => {
  it('returns false, shows an error toast, and keeps the feed on failure', async () => {
    const feedA = makeFeed({ id: 'fA' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      feeds: [feedA],
    });

    const before = fetchCount();
    queue({ error: 'FeedRepositoryError' }, 500);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(false);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fA']);
    expect(state.rows().map((row) => row.id)).toEqual(['iA1']);
    expect(ui.currentToast()).toMatchObject({
      message: i18n.translateErrorCode('FeedRepositoryError'),
      variant: 'error',
    });
  });
});
