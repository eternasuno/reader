import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makePage,
  noContentResponse,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

const loadOneUnreadPage = async (): Promise<number> => {
  await ctx.queueLoadedLibrary({
    scope: { kind: 'later' },
    items: [makePage({ id: 'p1', read: false })],
    feeds: [],
    saved: 1,
  });
  return ctx.fetchCount();
};

const waitForRequests = async (count: number): Promise<void> => {
  await vi.waitFor(() => expect(ctx.fetchCount()).toBe(count));
};

const failure = (): Response =>
  jsonResponse({ error: 'SavedPageRepositoryError' }, 500);

describe('read sync: serialized requests', () => {
  it('sends one request at a time per article, in intent order', async () => {
    const { state, solid } = ctx;
    const before = await loadOneUnreadPage();
    const first = ctx.pending();
    const second = ctx.pending();
    const third = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    solid.flush();
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ctx.requestBody(before)).toEqual({ read: true });

    first.resolve(noContentResponse());
    await waitForRequests(before + 2);
    expect(ctx.requestBody(before + 1)).toEqual({ read: false });

    const markReadAgain = state.toggleArticleRead('p1', true);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.fetchCount()).toBe(before + 2);

    second.resolve(noContentResponse());
    await waitForRequests(before + 3);
    expect(ctx.requestBody(before + 2)).toEqual({ read: true });
    third.resolve(noContentResponse());

    await expect(markRead).resolves.toBe(true);
    await expect(markUnread).resolves.toBe(false);
    await expect(markReadAgain).resolves.toBe(true);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.fetchCount()).toBe(before + 3);
  });
});

describe('read sync: coalescing', () => {
  it('coalesces toggles made while a request is in flight', async () => {
    const { state, solid } = ctx;
    const before = await loadOneUnreadPage();
    const first = ctx.pending();

    const calls = [
      state.toggleArticleRead('p1', true),
      state.toggleArticleRead('p1', false),
      state.toggleArticleRead('p1', true),
    ];
    first.resolve(noContentResponse());
    await expect(Promise.all(calls)).resolves.toEqual([true, false, true]);
    solid.flush();

    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
  });
});

describe('read sync: failures', () => {
  it('restores the last confirmed value when the latest intent fails', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadOneUnreadPage();
    const first = ctx.pending();
    const second = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    first.resolve(noContentResponse());
    await waitForRequests(before + 2);
    second.resolve(failure());

    await expect(markUnread).resolves.toBe(false);
    await expect(markRead).resolves.toBe(true);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('read sync: failure after a newer intent', () => {
  it('keeps a newer intent when an older request fails', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadOneUnreadPage();
    const first = ctx.pending();
    const second = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    first.resolve(noContentResponse());
    await waitForRequests(before + 2);
    const markReadAgain = state.toggleArticleRead('p1', true);
    second.resolve(failure());

    await expect(
      Promise.all([markRead, markUnread, markReadAgain])
    ).resolves.toEqual([true, false, true]);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 2);
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('read sync: failure of a superseded intent', () => {
  it('drops a failed request silently when the intent already returned to the confirmed value', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadOneUnreadPage();
    const first = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    first.resolve(failure());

    await expect(markRead).resolves.toBe(false);
    await expect(markUnread).resolves.toBe(true);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('read sync: session and reload', () => {
  it('ignores a response that lands after the session was cleared', async () => {
    const { state, solid, ui } = ctx;
    await loadOneUnreadPage();
    const first = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    state.markUnauthenticated();
    first.resolve(failure());

    await expect(markRead).resolves.toBe(false);
    solid.flush();
    expect(state.rows()).toEqual([]);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('read sync: reload during a request', () => {
  it('keeps a pending intent when the list reloads before the request settles', async () => {
    const { state, solid } = ctx;
    await loadOneUnreadPage();
    const first = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    ctx.queue({ items: [makePage({ id: 'p1', read: false })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);

    first.resolve(noContentResponse());
    await expect(markRead).resolves.toBe(true);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
  });
});

describe('read sync: bulk with an article in flight', () => {
  it('marks loaded rows read while an in-flight toggle keeps its own queue', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [
        makePage({ id: 'p1', read: false }),
        makePage({ id: 'p2', read: false }),
      ],
      feeds: [],
      saved: 2,
    });
    const before = ctx.fetchCount();
    const toggleRead = ctx.pending();
    const bulk = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    const marking = state.markLoadedRead();
    solid.flush();
    expect(state.rows().every((row) => row.read)).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.requestBody(before + 1)).toEqual({ ids: ['p1', 'p2'] });

    bulk.resolve(failure());
    await marking;
    solid.flush();
    expect(state.rows().map((row) => row.read)).toEqual([true, false]);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');

    toggleRead.resolve(noContentResponse());
    await expect(markRead).resolves.toBe(true);
    await expect(markUnread).resolves.toBe(false);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 2);
    expect(state.rows()[0].read).toBe(true);
  });
});
