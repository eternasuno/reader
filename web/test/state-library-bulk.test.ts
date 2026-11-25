import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
  noContentResponse,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('scope mark-all', () => {
  it('marks a single feed scope read with its own endpoint', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
      ],
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })],
      counts: [
        { feedId: 'f1', count: 1 },
        { feedId: 'f2', count: 1 },
      ],
    });

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await state.markScopeAllRead({ kind: 'feed', feedId: 'f1' });
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/feeds/f1/read-all');
    expect(state.rows().find((row) => row.id === 'i1')?.read).toBe(true);
    expect(state.rows().find((row) => row.id === 'i2')?.read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.feedUnreadCount('f2')).toBe(1);
  });
});

describe('saved mark-all', () => {
  it('zeroes the saved count when marking all saved pages read', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await state.markScopeAllRead();
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/read-all');
    expect(state.savedUnreadCount()).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('mark-all rollback', () => {
  it('rolls back a failed mark-all and reloads counts', async () => {
    const { state, solid, ui, i18n } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });

    ctx.queue({ error: 'FeedItemRepositoryError' }, 500);
    ctx.queueSidebar({
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });
    await state.markScopeAllRead({ kind: 'all' });
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(1);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('FeedItemRepositoryError')
    );
  });
});

describe('stale scope rollback guard', () => {
  it('does not roll back read state after a newer scope has loaded', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
    });

    const failure = ctx.pending();
    const marking = state.markLoadedRead();
    solid.flush();

    ctx.queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    ctx.queueSidebar({ saved: 1 });
    failure.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await marking;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
    expect(state.rows()[0].read).toBe(false);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('bulk vs toggle ownership: unread', () => {
  it('does not let a failed bulk rollback overwrite a row claimed by a newer toggle', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      feeds: [],
      saved: 2,
    });

    const bulkReq = ctx.pending();
    const toggleReq = ctx.pending();

    const marking = state.markLoadedRead();
    solid.flush();

    const toggling = state.toggleArticleRead('p1', false);
    solid.flush();
    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(false);

    toggleReq.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);

    ctx.queueSidebar({ saved: 2 });
    bulkReq.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await marking;
    solid.flush();

    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(false);
    expect(state.rows().find((row) => row.id === 'p2')?.read).toBe(false);
  });
});

describe('bulk vs toggle ownership: re-read', () => {
  it('keeps a newer read-true toggle when an earlier markScopeAllRead fails', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      feeds: [],
      saved: 2,
    });

    const bulkReq = ctx.pending();
    const toggleUnreadReq = ctx.pending();
    const toggleReadReq = ctx.pending();

    const marking = state.markScopeAllRead({ kind: 'later' });
    solid.flush();

    const markUnread = state.toggleArticleRead('p1', false);
    const markReadAgain = state.toggleArticleRead('p1', true);
    solid.flush();

    toggleUnreadReq.resolve(noContentResponse());
    toggleReadReq.resolve(noContentResponse());
    await Promise.all([markUnread, markReadAgain]);

    ctx.queueSidebar({ saved: 1 });
    bulkReq.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await marking;
    solid.flush();

    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(true);
    expect(state.rows().find((row) => row.id === 'p2')?.read).toBe(false);
  });
});
