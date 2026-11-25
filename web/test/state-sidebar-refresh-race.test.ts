import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeFolder,
} from './support/state-fixture';

const ctx = createStateTestContext();

const feedsListCallCount = (): number =>
  ctx.fetchMock.mock.calls.filter(([url]) => url === '/api/feeds').length;

beforeEach(async () => {
  await ctx.reset();
});

const REMOVAL_RACE_CASES = [
  {
    kind: 'feed',
    stale: {
      feeds: [makeFeed({ id: 'A' }), makeFeed({ id: 'B' })],
      counts: [
        { feedId: 'A', count: 3 },
        { feedId: 'B', count: 1 },
      ],
    },
    fresh: {
      feeds: [makeFeed({ id: 'B' })],
      counts: [{ feedId: 'B', count: 1 }],
    },
    remove: (s: typeof ctx.state) => s.removeFeedLocal('A'),
    assertCleared: (s: typeof ctx.state) => {
      expect(s.feeds().some((feed) => feed.id === 'A')).toBe(false);
      expect(s.feedUnreadCount('A')).toBe(0);
    },
    assertFinal: (s: typeof ctx.state) => {
      expect(s.feeds().map((feed) => feed.id)).toEqual(['B']);
      expect(s.feedUnreadCount('A')).toBe(0);
      expect(s.feedUnreadCount('B')).toBe(1);
    },
  },
  {
    kind: 'folder',
    stale: {
      feeds: [makeFeed({ id: 'A', folderId: 'F1' })],
      folders: [makeFolder('F1')],
      counts: [{ feedId: 'A', count: 3 }],
    },
    fresh: {
      feeds: [makeFeed({ id: 'A', folderId: null })],
      folders: [],
      counts: [{ feedId: 'A', count: 3 }],
    },
    remove: (s: typeof ctx.state) => s.removeFolderLocal('F1'),
    assertCleared: (s: typeof ctx.state) => {
      expect(s.folders()).toEqual([]);
    },
    assertFinal: (s: typeof ctx.state) => {
      expect(s.folders()).toEqual([]);
      expect(s.folderFeeds('F1')).toEqual([]);
      expect(s.topLevelFeeds().map((feed) => feed.id)).toEqual(['A']);
      expect(s.feedUnreadCount('A')).toBe(3);
    },
  },
];

describe('sidebar refresh race on removal', () => {
  it.each(REMOVAL_RACE_CASES)(
    're-fetches instead of restoring a $kind removed while refresh is in flight',
    async ({ stale, fresh, remove, assertCleared, assertFinal }) => {
      const { state, solid } = ctx;
      const staleRound = ctx.queueDeferredSidebar(stale);
      const freshRound = ctx.queueDeferredSidebar(fresh);

      const pending = state.refreshSidebar();
      remove(state);

      staleRound.resolve();
      await vi.waitFor(() => {
        expect(feedsListCallCount()).toBe(2);
      });
      assertCleared(state);

      freshRound.resolve();
      await pending;
      solid.flush();

      assertFinal(state);
      expect(feedsListCallCount()).toBe(2);
    }
  );
});

describe('sidebar refresh coalescing', () => {
  it('coalesces concurrent refreshSidebar calls into one request round', async () => {
    const { state, solid } = ctx;
    const round = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' })],
      counts: [{ feedId: 'A', count: 5 }],
      saved: 2,
    });

    const first = state.refreshSidebar();
    const second = state.refreshSidebar();
    expect(feedsListCallCount()).toBe(1);

    round.resolve();
    await Promise.all([first, second]);
    solid.flush();

    expect(feedsListCallCount()).toBe(1);
    expect(state.feedUnreadCount('A')).toBe(5);
    expect(state.savedUnreadCount()).toBe(2);
  });
});

describe('sidebar snapshot field invalidation', () => {
  it('skips snapshot fields invalidated by local mutations during flight while keeping others', async () => {
    const { state, solid } = ctx;
    ctx.queueSidebar({
      feeds: [makeFeed({ id: 'A', readerMode: 'default' })],
      folders: [makeFolder('F1')],
      counts: [{ feedId: 'A', count: 3 }],
      saved: 2,
    });
    await state.refreshSidebar();
    solid.flush();

    const stale = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A', readerMode: 'default' })],
      folders: [makeFolder('F1'), makeFolder('F2')],
      counts: [{ feedId: 'A', count: 3 }],
      saved: 2,
    });

    const refreshing = state.refreshSidebar();
    state.updateFeedLocal('A', { readerMode: 'extracted' });
    state.adjustFeedUnread('A', -1);
    state.adjustSavedUnread(-1);
    solid.flush();

    stale.resolve();
    await refreshing;
    solid.flush();

    expect(state.feeds()[0].readerMode).toBe('extracted');
    expect(state.feedUnreadCount('A')).toBe(2);
    expect(state.savedUnreadCount()).toBe(1);
    expect(state.folders().map((folder) => folder.id)).toEqual(['F1', 'F2']);
  });
});

describe('sidebar refresh rerun after local mutation', () => {
  it('reruns refresh when called after a local mutation while an older refresh is in flight', async () => {
    const { state, solid } = ctx;
    const round1 = ctx.queueDeferredSidebar({
      counts: [{ feedId: 'A', count: 3 }],
      saved: 1,
    });
    const round2 = ctx.queueDeferredSidebar({
      counts: [{ feedId: 'A', count: 4 }],
      saved: 5,
    });

    const first = state.refreshSidebar();
    state.adjustSavedUnread(1);
    const second = state.refreshSidebar();

    round1.resolve();
    await vi.waitFor(() => {
      expect(feedsListCallCount()).toBe(2);
    });
    round2.resolve();
    await Promise.all([first, second]);
    solid.flush();

    expect(state.feedUnreadCount('A')).toBe(4);
    expect(state.savedUnreadCount()).toBe(5);
  });
});

describe('sidebar post-mutation invalidation', () => {
  it('requests exactly one trailing round when invalidateSidebar runs during an in-flight read', async () => {
    const { state, solid } = ctx;
    const staleRound = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' })],
      folders: [],
      counts: [{ feedId: 'A', count: 1 }],
      saved: 0,
    });
    const freshRound = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' }), makeFeed({ id: 'B', folderId: 'F1' })],
      folders: [makeFolder('F1')],
      counts: [
        { feedId: 'A', count: 1 },
        { feedId: 'B', count: 3 },
      ],
      saved: 0,
    });

    const readRefresh = state.refreshSidebar();
    const firstWriteRefresh = state.invalidateSidebar();
    const secondWriteRefresh = state.invalidateSidebar();
    expect(feedsListCallCount()).toBe(1);

    staleRound.resolve();
    await vi.waitFor(() => {
      expect(feedsListCallCount()).toBe(2);
    });

    freshRound.resolve();
    await Promise.all([readRefresh, firstWriteRefresh, secondWriteRefresh]);
    solid.flush();

    expect(feedsListCallCount()).toBe(2);
    expect(state.feeds().map((feed) => feed.id)).toEqual(['A', 'B']);
    expect(state.folders().map((folder) => folder.id)).toEqual(['F1']);
  });
});

describe('OPML import sidebar invalidation', () => {
  it('refreshes imported OPML feeds when a pre-import snapshot was already in flight', async () => {
    const { state, solid } = ctx;
    const { useOpmlImport } = await import('../src/routes/importOpml');

    const preImport = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' })],
      counts: [{ feedId: 'A', count: 1 }],
    });
    const inFlightRead = state.refreshSidebar();

    ctx.queue({ importedFeeds: 1, skippedFeeds: 0, createdFolders: 1 });
    const postImport = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' }), makeFeed({ id: 'B', folderId: 'F1' })],
      folders: [makeFolder('F1')],
      counts: [
        { feedId: 'A', count: 1 },
        { feedId: 'B', count: 2 },
      ],
    });

    const opml = useOpmlImport();
    const file = new File(['<opml/>'], 'feeds.opml', { type: 'text/xml' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    opml.onChange({ currentTarget: input } as unknown as Event);

    await vi.waitFor(() => {
      expect(
        ctx.fetchMock.mock.calls.some(([url]) => url === '/api/opml')
      ).toBe(true);
    });

    preImport.resolve();
    await vi.waitFor(() => {
      expect(feedsListCallCount()).toBe(2);
    });

    postImport.resolve();
    await inFlightRead;
    solid.flush();

    expect(feedsListCallCount()).toBe(2);
    expect(state.feeds().map((feed) => feed.id)).toEqual(['A', 'B']);
    expect(state.folders().map((folder) => folder.id)).toEqual(['F1']);
  });
});
