import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse,
  makeFeed,
  makeItem,
  noContentResponse,
  uuid,
} from './support/state-fixture';

const ctx = createStateTestContext();
const target = makeFeed({ id: uuid(1001), folderId: 'd1' });
const sibling = makeFeed({ id: uuid(1002), folderId: 'd1' });

beforeEach(async () => {
  await ctx.reset();
});

/** Folder `d1` holding `i1` (moved feed `f1`) and `i2` (feed `f2`). */
const loadFolder = (): Promise<void> =>
  ctx.queueLoadedLibrary({
    scope: { kind: 'folder', folderId: 'd1' },
    items: [
      makeItem({ id: uuid(1007), feedId: uuid(1001) }),
      makeItem({ id: uuid(1008), feedId: uuid(1002) }),
    ],
    feeds: [target, sibling],
  });

const readStates = (
  rows: ReadonlyArray<{ id: string; read: boolean }>
): Array<[string, boolean]> => rows.map((row) => [row.id, row.read]);

const failed = (): Response => jsonResponse({ error: 'FolderNotFound' }, 404);

describe('feed move rollback keeps a read toggle on a retained article', () => {
  it('keeps a read toggle that settled while the retained article was moving', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    state.retainReaderArticle(uuid(1007));

    const move = ctx.pending();
    const toggle = ctx.pending();
    const moving = state.moveFeedToFolder(target, null);
    const toggling = state.toggleArticleRead(uuid(1007), true);
    solid.flush();

    toggle.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    move.resolve(failed());
    await expect(moving).resolves.toBe(false);
    solid.flush();

    expect(readStates(state.rows())).toEqual([
      [uuid(1007), true],
      [uuid(1008), false],
    ]);
  });
});

describe('feed move rollback keeps a read toggle after the reader moves on', () => {
  it('keeps a read toggle on a dropped article after the reader moves on', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    state.retainReaderArticle(uuid(1007));

    const move = ctx.pending();
    const toggle = ctx.pending();
    const moving = state.moveFeedToFolder(target, null);
    solid.flush();
    state.retainReaderArticle(uuid(1008));
    const toggling = state.toggleArticleRead(uuid(1007), true);
    solid.flush();

    toggle.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    move.resolve(failed());
    await expect(moving).resolves.toBe(false);
    solid.flush();

    expect(readStates(state.rows())).toEqual([
      [uuid(1007), true],
      [uuid(1008), false],
    ]);
  });
});

describe('feed move rollback with an overlapping move', () => {
  it('keeps a read toggle when the newer overlapping move fails first', async () => {
    const { state, solid } = ctx;
    await loadFolder();

    const firstMove = ctx.pending();
    const secondMove = ctx.pending();
    const toggle = ctx.pending();
    const p1 = state.moveFeedToFolder(target, 'd2');
    const p2 = state.moveFeedToFolder(target, 'd1');
    const toggling = state.toggleArticleRead(uuid(1007), true);
    solid.flush();

    toggle.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    secondMove.resolve(failed());
    await expect(p2).resolves.toBe(false);
    solid.flush();

    firstMove.resolve(failed());
    await expect(p1).resolves.toBe(false);
    solid.flush();

    expect(readStates(state.rows())).toEqual([
      [uuid(1007), true],
      [uuid(1008), false],
    ]);
  });
});

describe('feed move rollback membership and order', () => {
  it('restores a failed move rows at their original positions', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1002) }),
        makeItem({ id: uuid(1009), feedId: uuid(1001) }),
      ],
      feeds: [target, sibling],
    });

    ctx.queue({ error: 'FolderNotFound' }, 404);
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(false);
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual([
      uuid(1007),
      uuid(1009),
      uuid(1008),
    ]);
  });
});

it('filters an incoming snapshot using moves made since dispatch and restores its queued IDs on rollback', async () => {
  const { state } = ctx;
  ctx.queueSidebar({ feeds: [target, sibling] });
  await state.refreshSidebar();
  const snapshot = ctx.pending();
  const loading = state.loadScopeFirstPage(
    { kind: 'folder', folderId: 'd1' },
    false
  );
  const move = ctx.pending();
  const moving = state.moveFeedToFolder(target, null);
  const moved = makeItem({ id: uuid(60), feedId: target.id });
  const kept = makeItem({ id: uuid(61), feedId: sibling.id });
  ctx.queue({ items: [kept] });
  snapshot.resolve(jsonResponse(feedOrder([moved, kept])));
  await loading;
  expect(ctx.requestUrl(6)).toBe(`/api/feed-items?ids=${kept.id}`);
  expect(state.rowIds()).toEqual([kept.id]);

  ctx.queue({ items: [moved] });
  move.resolve(jsonResponse({ error: 'FolderNotFound' }, 404));
  await moving;
  await vi.waitFor(() => expect(state.rowIds()).toEqual([moved.id, kept.id]));
  expect(ctx.requestUrl(7)).toBe(`/api/feed-items?ids=${moved.id}`);
});

it('skips a moved feed when an already dispatched batch settles', async () => {
  const { state } = ctx;
  ctx.queueSidebar({ feeds: [target, sibling] });
  await state.refreshSidebar();
  const moved = makeItem({ id: uuid(60), feedId: target.id });
  const kept = makeItem({ id: uuid(61), feedId: sibling.id });
  ctx.queue(feedOrder([moved, kept]));
  const batch = ctx.pending();
  const loading = state.loadScopeFirstPage(
    { kind: 'folder', folderId: 'd1' },
    false
  );
  await vi.waitFor(() => expect(ctx.requestUrl(5)).toContain(moved.id));
  ctx.queueEmpty();
  await state.moveFeedToFolder(target, null);
  batch.resolve(jsonResponse({ items: [moved, kept] }));
  await loading;
  await state.loadMore();
  expect(state.rowIds()).toEqual([kept.id]);
  expect(ctx.fetchCount()).toBe(7);
});

describe('feed move success evicts dropped rows', () => {
  it('evicts the dropped rows once the move succeeds', async () => {
    const { state, solid } = ctx;
    await loadFolder();

    ctx.queueEmpty();
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(true);
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual([uuid(1008)]);
    expect(state.articleById(uuid(1007))).toBeNull();
  });
});
