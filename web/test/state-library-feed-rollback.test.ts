import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  noContentResponse,
} from './support/state-fixture';

const ctx = createStateTestContext();
const target = makeFeed({ id: 'f1', folderId: 'd1' });
const sibling = makeFeed({ id: 'f2', folderId: 'd1' });

beforeEach(async () => {
  await ctx.reset();
});

/** Folder `d1` holding `i1` (moved feed `f1`) and `i2` (feed `f2`). */
const loadFolder = (): Promise<void> =>
  ctx.queueLoadedLibrary({
    scope: { kind: 'folder', folderId: 'd1' },
    items: [
      makeItem({ id: 'i1', feedId: 'f1' }),
      makeItem({ id: 'i2', feedId: 'f2' }),
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
    state.retainReaderArticle('i1');

    const move = ctx.pending();
    const toggle = ctx.pending();
    const moving = state.moveFeedToFolder(target, null);
    const toggling = state.toggleArticleRead('i1', true);
    solid.flush();

    toggle.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    move.resolve(failed());
    await expect(moving).resolves.toBe(false);
    solid.flush();

    expect(readStates(state.rows())).toEqual([
      ['i1', true],
      ['i2', false],
    ]);
  });
});

describe('feed move rollback keeps a read toggle after the reader moves on', () => {
  it('keeps a read toggle on a dropped article after the reader moves on', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    state.retainReaderArticle('i1');

    const move = ctx.pending();
    const toggle = ctx.pending();
    const moving = state.moveFeedToFolder(target, null);
    solid.flush();
    state.retainReaderArticle('i2');
    const toggling = state.toggleArticleRead('i1', true);
    solid.flush();

    toggle.resolve(noContentResponse());
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    move.resolve(failed());
    await expect(moving).resolves.toBe(false);
    solid.flush();

    expect(readStates(state.rows())).toEqual([
      ['i1', true],
      ['i2', false],
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
    const toggling = state.toggleArticleRead('i1', true);
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
      ['i1', true],
      ['i2', false],
    ]);
  });
});

describe('feed move rollback membership and order', () => {
  it('restores a failed move rows at their original positions', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
        makeItem({ id: 'i3', feedId: 'f1' }),
      ],
      feeds: [target, sibling],
    });

    ctx.queue({ error: 'FolderNotFound' }, 404);
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(false);
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('feed move success evicts dropped rows', () => {
  it('evicts the dropped rows once the move succeeds', async () => {
    const { state, solid } = ctx;
    await loadFolder();

    ctx.queueEmpty();
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(true);
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i2']);
    expect(state.articleById('i1')).toBeNull();
  });
});
