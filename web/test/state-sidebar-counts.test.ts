import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeFolder,
  makePage,
  noContentResponse,
} from './support/state-fixture';

type ReadSyncMod = typeof import('../src/state/read-sync');

const ctx = createStateTestContext();
let readSync: ReadSyncMod;

const queueFoldersOfFeeds = async (): Promise<void> => {
  ctx.queueSidebar({
    feeds: [
      makeFeed({ id: 'f1', folderId: 'd1' }),
      makeFeed({ id: 'f2', folderId: 'd1' }),
      makeFeed({ id: 'f3' }),
    ],
    counts: [
      { feedId: 'f1', count: 2 },
      { feedId: 'f2', count: 3 },
      { feedId: 'f3', count: 1 },
    ],
    saved: 2,
  });
  await ctx.state.refreshSidebar();
  ctx.solid.flush();
};

const feedsListCallCount = (): number =>
  ctx.fetchMock.mock.calls.filter(([url]) => url === '/api/feeds').length;

const pageTarget = (id: string, read = false) => ({
  id,
  kind: 'later' as const,
  feedId: null,
  read,
});

beforeEach(async () => {
  await ctx.reset();
  readSync = await import('../src/state/read-sync');
});

describe('unread count adjustments', () => {
  it('adjusts and clamps saved and feed unread counts', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();

    state.adjustSavedUnread(1);
    state.adjustFeedUnread('f1', -1);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(3);
    expect(state.feedUnreadCount('f1')).toBe(1);

    state.adjustSavedUnread(-10);
    state.adjustFeedUnread('f1', -10);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(0);
    expect(state.feedUnreadCount('f1')).toBe(0);

    state.adjustSavedUnread(5);
    state.adjustFeedUnread('f2', 2);
    state.adjustFeedUnread('f2', -1);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(5);
    expect(state.feedUnreadCount('f2')).toBe(4);
  });
});

describe('unread count resets', () => {
  it('clears only the removed feed unread count', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();

    state.clearFeedUnread('f1');
    solid.flush();
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.feedUnreadCount('f2')).toBe(3);
    expect(state.feedUnreadCount('f3')).toBe(1);
  });
});

describe('local feed and folder edits', () => {
  it('updates, removes feeds and dissolves folders locally', async () => {
    const { state, solid } = ctx;
    ctx.queueSidebar({
      feeds: [
        makeFeed({ id: 'f1', folderId: 'd1' }),
        makeFeed({ id: 'f2', folderId: 'd1' }),
      ],
      folders: [makeFolder('d1')],
      counts: [
        { feedId: 'f1', count: 1 },
        { feedId: 'f2', count: 2 },
      ],
    });
    await state.refreshSidebar();
    solid.flush();

    state.updateFeedLocal('f1', { title: 'Renamed', readerMode: 'extracted' });
    solid.flush();
    expect(state.feeds()[0].title).toBe('Renamed');
    expect(state.feeds()[0].readerMode).toBe('extracted');

    state.removeFolderLocal('d1');
    solid.flush();
    expect(state.folders()).toHaveLength(0);
    expect(state.feeds().every((feed) => feed.folderId === null)).toBe(true);

    state.removeFeedLocal('f2');
    solid.flush();
    expect(state.feeds().map((feed) => feed.id)).toEqual(['f1']);
    expect(state.feedUnreadMap()).toEqual({ f1: 1 });
  });
});

describe('queue-busy count drop and drain refresh', () => {
  it('drops count GET dispatched while queue is busy, applies lists, and refreshes once on drain', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();
    const write = ctx.pending();
    void readSync.requestRead(pageTarget('p1', false), true);
    expect(state.savedUnreadCount()).toBe(1);

    const stale = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f4' })],
      counts: [{ feedId: 'f1', count: 9 }],
      saved: 9,
    });
    const fresh = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f4' })],
      counts: [{ feedId: 'f1', count: 2 }],
      saved: 1,
    });
    const refreshing = state.refreshSidebar();
    stale.resolve();
    await refreshing;
    solid.flush();

    expect(state.feeds().map((f) => f.id)).toEqual(['f1', 'f4']);
    expect(state.savedUnreadCount()).toBe(1);
    expect(state.feedUnreadCount('f1')).toBe(2);
    expect(feedsListCallCount()).toBe(2);

    write.resolve(noContentResponse());
    await vi.waitFor(() => expect(feedsListCallCount()).toBe(3));
    fresh.resolve();
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
    expect(state.savedUnreadCount()).toBe(1);
    expect(feedsListCallCount()).toBe(3);
  });
});

describe('coalesced intent epoch drop', () => {
  it('drops count GET dispatched idle when a coalesced intent advances queue epoch', async () => {
    const { state } = ctx;
    await queueFoldersOfFeeds();

    const stale = ctx.queueDeferredSidebar({ saved: 99 });
    const refreshing = state.refreshSidebar();
    const hold = ctx.pending();
    const fresh = ctx.queueDeferredSidebar({
      counts: [{ feedId: 'f1', count: 2 }],
      saved: 2,
    });
    const pHold = readSync.requestRead(pageTarget('p-hold', false), true);
    const pCoal1 = readSync.requestRead(pageTarget('p-coal', false), true);
    const pCoal2 = readSync.requestRead(pageTarget('p-coal', true), false);
    stale.resolve();
    await refreshing;
    expect(state.savedUnreadCount()).toBe(1);

    hold.resolve(noContentResponse());
    await Promise.all([pHold, pCoal1, pCoal2]);
    await vi.waitFor(() => expect(feedsListCallCount()).toBe(3));
    fresh.resolve();
    await vi.waitFor(() => expect(state.savedUnreadCount()).toBe(2));
  });
});

describe('barrier epoch drop', () => {
  it('drops count GET dispatched idle when a barrier advances queue epoch', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();

    const stale = ctx.queueDeferredSidebar({
      counts: [{ feedId: 'f1', count: 88 }],
      saved: 88,
    });
    const refreshing = state.refreshSidebar();
    let releaseBarrier!: (outcome: 'ok') => void;
    const barrier = readSync.enqueueBarrier({
      affects: () => true,
      execute: () =>
        new Promise((res) => {
          releaseBarrier = res;
        }),
    });
    stale.resolve();
    await refreshing;
    solid.flush();
    expect(state.feedUnreadCount('f1')).toBe(2);
    expect(state.savedUnreadCount()).toBe(2);

    ctx.queueSidebar({ counts: [{ feedId: 'f1', count: 4 }], saved: 2 });
    releaseBarrier('ok');
    await barrier;
    await vi.waitFor(() => expect(state.feedUnreadCount('f1')).toBe(4));
  });
});

describe('late GET no double count', () => {
  it('prevents double count from optimistic toggle plus late stale GET', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();

    const late = ctx.queueDeferredSidebar({ saved: 2 });
    const pRefresh = state.refreshSidebar();
    const patch = ctx.pending();
    const toggle = readSync.requestRead(pageTarget('p1', false), true);
    expect(state.savedUnreadCount()).toBe(1);

    ctx.queueSidebar({ counts: [{ feedId: 'f1', count: 2 }], saved: 1 });
    patch.resolve(noContentResponse());
    await toggle;
    late.resolve();
    await pRefresh;
    solid.flush();
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('ok barrier settlement and unread badges', () => {
  it('shows a covered idle row read without decrementing the saved unread badge', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
      feeds: [],
      saved: 0,
    });
    ctx.fetchMock.mockImplementation(() =>
      Promise.resolve(noContentResponse())
    );
    const older = readSync.beginRecordSnapshot();

    await state.toggleArticleRead('p1', false);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(1);

    const barrier = readSync.enqueueBarrier({
      affects: (entry) => entry.kind === 'later',
      execute: () => Promise.resolve('ok'),
    });
    await expect(barrier).resolves.toBe('ok');
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(1);
    older.release();
  });
});
