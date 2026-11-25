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

describe('optimistic read toggle', () => {
  it('marks a row read optimistically and keeps it under the unread filter', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, true);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(true);
    solid.flush();

    expect(state.rows()).toHaveLength(1);
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/p1');
    expect(ctx.requestInit(before).method).toBe('PATCH');
    expect(ctx.requestBody(before)).toEqual({ read: true });
  });
});

describe('feed item read toggle', () => {
  it('marks a feed item read through the feed-items endpoint', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead('i1', true)).resolves.toBe(true);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/feed-items/i1');
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('read no-op', () => {
  it('is a no-op when the read state already matches', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });

    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(true);
    expect(ctx.fetchCount()).toBe(1);
  });
});

describe('read toggle rollback', () => {
  it('rolls back a failed read toggle and reloads counts', async () => {
    const { state, solid, ui, i18n } = ctx;
    ctx.queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    ctx.queueSidebar({ saved: 1 });
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(false);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/p1');
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SavedPageRepositoryError')
    );
  });
});

describe('read toggle race: late failure', () => {
  it('does not let a late failure undo a newer read toggle on the same article', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
      feeds: [],
      saved: 1,
    });

    const first = ctx.pending();
    const second = ctx.pending();

    const firstCall = state.toggleArticleRead('p1', true);
    const secondCall = state.toggleArticleRead('p1', false);
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);

    first.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(firstCall).resolves.toBe(false);
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);

    second.resolve(noContentResponse());
    await expect(secondCall).resolves.toBe(true);
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('read toggle race: confirmed rollback', () => {
  it('rolls back to the server-confirmed value when an earlier toggle succeeded', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
      feeds: [],
      saved: 1,
    });

    const first = ctx.pending();
    const second = ctx.pending();

    const firstCall = state.toggleArticleRead('p1', true);
    const secondCall = state.toggleArticleRead('p1', false);
    solid.flush();

    first.resolve(noContentResponse());
    await expect(firstCall).resolves.toBe(true);

    second.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    ctx.queueSidebar({ saved: 0 });
    await expect(secondCall).resolves.toBe(false);
    solid.flush();

    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
  });
});

describe('read toggle race: newer failure settles first', () => {
  it('reconciles to the still-in-flight earlier toggle when the newer request fails first', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
      feeds: [],
      saved: 1,
    });

    const first = ctx.pending();
    const second = ctx.pending();

    const firstCall = state.toggleArticleRead('p1', true);
    const secondCall = state.toggleArticleRead('p1', false);
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);

    second.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(secondCall).resolves.toBe(false);
    solid.flush();

    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ui.currentToast()?.variant).toBe('error');

    first.resolve(noContentResponse());
    await expect(firstCall).resolves.toBe(true);
    solid.flush();

    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
  });
});

describe('read toggle race: newer failure then older failure', () => {
  it('reverts to the original value when both fail with the newer request settling first', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
      feeds: [],
      saved: 1,
    });

    const first = ctx.pending();
    const second = ctx.pending();

    const firstCall = state.toggleArticleRead('p1', true);
    const secondCall = state.toggleArticleRead('p1', false);
    solid.flush();

    second.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(secondCall).resolves.toBe(false);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);

    ctx.queueSidebar({ saved: 1 });
    first.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(firstCall).resolves.toBe(false);
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('mark loaded read', () => {
  it('marks every loaded unread row read in one batch', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f1' }),
        makeItem({ id: 'i3', feedId: 'f1', read: true }),
      ],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 2 }],
    });

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await state.markLoadedRead();
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/feed-items/read');
    expect(ctx.requestBody(before)).toEqual({ ids: ['i1', 'i2'] });
    expect(state.rows().every((row) => row.read)).toBe(true);
    expect(state.feedUnreadCount('f1')).toBe(0);

    const afterBatch = ctx.fetchCount();
    await state.markLoadedRead();
    expect(ctx.fetchCount()).toBe(afterBatch);
  });
});

describe('mark loaded read rollback', () => {
  it('rolls back a failed mark-loaded-read', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      saved: 1,
    });

    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    ctx.queueSidebar({ saved: 1 });
    await state.markLoadedRead();
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
