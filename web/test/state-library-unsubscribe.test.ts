import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse as json,
  makeFeed,
  makeItem,
  uuid,
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
const queueItems = (items: Array<ReturnType<typeof makeItem>>): void => {
  queue(feedOrder(items, B));
  queue({ items });
};

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
    const feedA = makeFeed({ id: uuid(1005) });
    const feedB = makeFeed({ id: uuid(1006) });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: uuid(1011), feedId: uuid(1005) }),
        makeItem({ id: uuid(1013), feedId: uuid(1006) }),
      ],
      feeds: [feedA, feedB],
    });

    const before = fetchCount();
    queueEmpty();
    queueItems([
      makeItem({ id: uuid(1013), feedId: uuid(1006) }),
      makeItem({ id: uuid(1014), feedId: uuid(1006) }),
    ]);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 3);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe(`/api/feeds/${uuid(1005)}`);
    expect(requestUrl(before + 1)).toBe('/api/feed-items/order?unread=false');
    expect(state.feeds().map((feed) => feed.id)).toEqual([uuid(1006)]);
    expect(state.rows().map((row) => row.id)).toEqual([uuid(1013), uuid(1014)]);
    expect(state.listBoundary()).toBe(B);
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed unmounted', () => {
  it('skips the page-1 reload when unmounted', async () => {
    const feedA = makeFeed({ id: uuid(1005) });
    const feedB = makeFeed({ id: uuid(1006) });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: uuid(1011), feedId: uuid(1005) }),
        makeItem({ id: uuid(1013), feedId: uuid(1006) }),
      ],
      feeds: [feedA, feedB],
    });

    unmountLibrary();
    const before = fetchCount();
    queueEmpty();
    queueItems([makeItem({ id: uuid(1013), feedId: uuid(1006) })]);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe(`/api/feeds/${uuid(1005)}`);
    expect(state.feeds().map((feed) => feed.id)).toEqual([uuid(1006)]);
    expect(state.rows().map((row) => row.id)).toEqual([uuid(1011), uuid(1013)]);
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed stale page discard', () => {
  it('discards an in-flight page response requested before the delete', async () => {
    const feedA = makeFeed({ id: uuid(1005) });
    const feedB = makeFeed({ id: uuid(1006) });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1011), feedId: uuid(1005) })],
      queuedItems: [
        ...Array.from({ length: 29 }, (_, i) =>
          makeItem({ id: uuid(300 + i), feedId: uuid(1005) })
        ),
        makeItem({ id: uuid(1012), feedId: uuid(1005) }),
      ],
      feeds: [feedA, feedB],
    });

    const latePage = pending();
    const pendingNext = state.loadMore();

    queueEmpty();
    queueItems([makeItem({ id: uuid(1013), feedId: uuid(1006) })]);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    latePage.resolve(
      json({ items: [makeItem({ id: uuid(1012), feedId: uuid(1005) })] })
    );
    await pendingNext;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual([uuid(1013)]);
    expect(state.listBoundary()).toBe(B);
    expect(state.loadingMore()).toBe(false);
  });
});

describe('unsubscribeFeed failure', () => {
  it('returns false, shows an error toast, and keeps the feed on failure', async () => {
    const feedA = makeFeed({ id: uuid(1005) });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1011), feedId: uuid(1005) })],
      feeds: [feedA],
    });

    const before = fetchCount();
    queue({ error: 'FeedRepositoryError' }, 500);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(false);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(state.feeds().map((feed) => feed.id)).toEqual([uuid(1005)]);
    expect(state.rows().map((row) => row.id)).toEqual([uuid(1011)]);
    expect(ui.currentToast()).toMatchObject({
      message: i18n.translateErrorCode('FeedRepositoryError'),
      variant: 'error',
    });
  });
});
