import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeFolder,
} from './support/state-fixture';

const ctx = createStateTestContext();

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

beforeEach(async () => {
  await ctx.reset();
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

    state.setSavedUnread(5);
    state.adjustFeedUnread('f2', 2);
    state.adjustFeedUnread('f2', -1);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(5);
    expect(state.feedUnreadCount('f2')).toBe(4);
  });
});

describe('unread count resets', () => {
  it('clears folder and all-feeds unread counts', async () => {
    const { state, solid } = ctx;
    await queueFoldersOfFeeds();

    state.clearFolderUnread('d1');
    solid.flush();
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.feedUnreadCount('f2')).toBe(0);
    expect(state.feedUnreadCount('f3')).toBe(1);

    state.clearAllFeedsUnread();
    solid.flush();
    expect(state.feedUnreadMap()).toEqual({});
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

    state.updateFeedLocal('f1', { title: 'Renamed', readerMode: 'embedded' });
    solid.flush();
    expect(state.feeds()[0].title).toBe('Renamed');
    expect(state.feeds()[0].readerMode).toBe('embedded');

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
