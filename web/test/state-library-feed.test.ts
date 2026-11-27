import { beforeEach, describe, expect, it } from 'vitest';
import { LatestTokenMap } from '../src/state/library-mutations';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  noContentResponse,
  uuid,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('feed move', () => {
  it('moves a feed out of the open folder scope without reloading the list', async () => {
    const { state, solid, ui, i18n } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1002) }),
      ],
      feeds: [target, makeFeed({ id: uuid(1002), folderId: 'd1' })],
    });
    expect(state.rowIds()).toHaveLength(2);

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(true);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe(`/api/feeds/${uuid(1001)}`);
    expect(ctx.requestInit(before).method).toBe('PATCH');
    expect(ctx.requestBody(before)).toEqual({ folderId: null });
    expect(
      state.feeds().find((feed) => feed.id === uuid(1001))?.folderId
    ).toBeNull();
    expect(state.rowIds()).toEqual([uuid(1008)]);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('folders.movedToast'))
    );
  });
});

describe('feed move rollback', () => {
  it('rolls back a failed feed move and restores removed rows', async () => {
    const { state, solid, ui } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [target],
    });

    ctx.queue({ error: 'FolderNotFound' }, 404);
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd1'
    );
    expect(state.rowIds()).toHaveLength(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('feed move race: late failure', () => {
  it('does not let a late failed move overwrite a newer feed move', async () => {
    const { state, solid } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1002) }),
      ],
      feeds: [target, makeFeed({ id: uuid(1002), folderId: 'd1' })],
    });

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();

    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd3');
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd3'
    );
    expect(state.rowIds()).toEqual([uuid(1008)]);

    firstMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p1).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd3'
    );
    expect(state.rowIds()).toEqual([uuid(1008)]);

    secondMove.resolve(noContentResponse());
    await expect(p2).resolves.toBe(true);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd3'
    );
  });
});

describe('feed move race: confirmed rollback', () => {
  it('rolls back to the confirmed folder when move 1 succeeds and move 2 fails', async () => {
    const { state, solid } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [target],
    });

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();

    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd3');
    solid.flush();

    firstMove.resolve(noContentResponse());
    await expect(p1).resolves.toBe(true);

    secondMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p2).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd2'
    );
    expect(state.rowIds()).toHaveLength(0);
  });
});

describe('feed move race: double failure', () => {
  it('restores dropped rows when both overlapping moves fail', async () => {
    const { state, solid } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [target],
    });

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();

    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd3');
    solid.flush();

    firstMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p1).resolves.toBe(false);

    secondMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p2).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd1'
    );
    expect(state.rowIds()).toEqual([uuid(1007)]);
  });
});

describe('feed move race: newer failure settles first', () => {
  it('reconciles to the still-in-flight earlier move when the newer move fails first', async () => {
    const { state, solid, ui, i18n } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [target],
    });

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();

    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd3');
    solid.flush();

    secondMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p2).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd2'
    );
    expect(state.rowIds()).toHaveLength(0);
    expect(ui.currentToast()?.variant).toBe('error');

    firstMove.resolve(noContentResponse());
    await expect(p1).resolves.toBe(true);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd2'
    );
    expect(state.rowIds()).toHaveLength(0);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('folders.movedToast'))
    );
  });
});

describe('feed move race: newer success settles first', () => {
  it('keeps the newer move when it succeeds first and the older move settles later', async () => {
    const { state, solid } = ctx;
    const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [target],
    });

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();

    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd3');
    solid.flush();

    secondMove.resolve(noContentResponse());
    await expect(p2).resolves.toBe(true);
    solid.flush();
    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd3'
    );

    firstMove.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
    await expect(p1).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === uuid(1001))?.folderId).toBe(
      'd3'
    );
    expect(state.rowIds()).toHaveLength(0);
  });
});

describe('LatestTokenMap release', () => {
  it('releases settled keys conditionally without deleting newer claims', () => {
    const map = new LatestTokenMap();
    const t1 = map.claim(uuid(1001));
    const t2 = map.claim(uuid(1001));

    map.release(uuid(1001), t1);
    expect(map.isCurrent(uuid(1001), t2)).toBe(true);

    map.release(uuid(1001), t2);
    expect(map.isCurrent(uuid(1001), t2)).toBe(false);
  });
});

describe('feed order reload', () => {
  it('reloads the active feed list when its order changes', async () => {
    const { state, solid } = ctx;
    const target = makeFeed({ id: uuid(1001) });
    ctx.queue({ groups: [], boundary: B });
    await state.loadScopeFirstPage({ kind: 'feed', feedId: uuid(1001) }, false);
    ctx.queueSidebar({ feeds: [target] });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    ctx.queue({ groups: [], boundary: B });
    const before = ctx.fetchCount();
    await state.changeFeedOrder(target, 'oldest');
    solid.flush();

    expect(ctx.requestInit(before).method).toBe('PUT');
    expect(ctx.requestUrl(before)).toBe(`/api/feeds/${uuid(1001)}/order`);
    expect(state.feeds()[0].order).toBe('oldest');
    expect(state.listBoundary()).toBe(B);
    expect(ctx.requestUrl(before + 1)).toBe(
      `/api/feeds/${uuid(1001)}/items/order?unread=false`
    );
  });
});

describe('stored feed order', () => {
  it('omits the order param so the stored feed order applies', async () => {
    const { state, solid } = ctx;
    ctx.queueSidebar({
      feeds: [makeFeed({ id: uuid(1001), order: 'oldest' })],
    });
    await state.refreshSidebar();
    solid.flush();

    ctx.queue({ groups: [], boundary: B });
    await state.loadScopeFirstPage({ kind: 'feed', feedId: uuid(1001) }, false);
    solid.flush();

    expect(ctx.requestUrl(4)).toBe(
      `/api/feeds/${uuid(1001)}/items/order?unread=false`
    );
  });
});

describe('feed reader mode', () => {
  it('updates the feed reader mode, reports failures, and discards stale responses', async () => {
    const { state, solid, ui } = ctx;
    const target = makeFeed({ id: uuid(1001) });
    ctx.queueSidebar({ feeds: [target] });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await state.changeFeedReaderMode(target, 'extracted');
    solid.flush();
    expect(ctx.requestUrl(before)).toBe(`/api/feeds/${uuid(1001)}/reader-mode`);
    expect(state.feeds()[0].readerMode).toBe('extracted');

    ctx.queue({ error: 'FeedRepositoryError' }, 500);
    await state.changeFeedReaderMode(target, 'default');
    solid.flush();
    expect(state.feeds()[0].readerMode).toBe('extracted');
    expect(ui.currentToast()?.variant).toBe('error');

    const slow = ctx.pending();
    const fast = ctx.pending();
    const first = state.changeFeedReaderMode(target, 'extracted');
    const second = state.changeFeedReaderMode(target, 'default');
    fast.resolve(noContentResponse());
    await second;
    slow.resolve(noContentResponse());
    await first;
    solid.flush();
    expect(state.feeds()[0].readerMode).toBe('default');
  });
});
