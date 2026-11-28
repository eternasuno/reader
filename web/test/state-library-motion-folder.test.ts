import { describe, expect, it, vi } from 'vitest';
import {
  B2,
  ctx,
  deferTransitions,
  folderId,
  loadFolder,
  moved,
  movedItem,
  nextTask,
  snapshotModule,
  stays,
  staysItem,
} from './support/motion-fixture';
import { jsonResponse, uuid } from './support/state-fixture';

describe('changesRows', () => {
  it('compares visible rows after the folder overrides a replacement keeps', async () => {
    await loadFolder();
    const snapshot = await snapshotModule();
    const { feedMoveTracker } = await import('../src/state/library-mutations');
    const same = {
      ids: [movedItem.id, staysItem.id],
      feedIds: new Map([
        [movedItem.id, moved.id],
        [staysItem.id, stays.id],
      ]),
      boundary: B2,
    };

    snapshot.updateFolderMembership(moved.id, null);
    ctx.solid.flush();
    // A settled override retires on replacement, revealing the row again.
    expect(snapshot.changesRows(same)).toBe(true);

    feedMoveTracker.begin(moved.id, folderId, null);
    const withoutHidden = { ...same, ids: [staysItem.id] };
    // Dropping a row a pending move already hides changes nothing visible.
    expect(snapshot.changesRows(withoutHidden)).toBe(false);
  });
});

describe('folderMoveChangesRows', () => {
  it('is true only when a move shows or hides rows of the active folder', async () => {
    await loadFolder();
    const { folderMoveChangesRows } = await snapshotModule();

    expect(folderMoveChangesRows(moved.id, null)).toBe(true);
    expect(folderMoveChangesRows(moved.id, folderId)).toBe(false);
    expect(folderMoveChangesRows(uuid(99), null)).toBe(false);

    (await snapshotModule()).updateFolderMembership(moved.id, null);
    ctx.solid.flush();
    expect(folderMoveChangesRows(moved.id, folderId)).toBe(true);
    expect(folderMoveChangesRows(moved.id, uuid(98))).toBe(false);
  });

  it('is false outside folder lists', async () => {
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [movedItem],
      feeds: [moved],
    });
    const { folderMoveChangesRows } = await snapshotModule();
    expect(folderMoveChangesRows(moved.id, null)).toBe(false);
  });
});

describe('animated local changes', () => {
  it('sends a folder move at once but applies its rollback only after the optimistic change is shown', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    const transition = deferTransitions();
    const move = ctx.pending();
    const before = ctx.fetchCount();
    const moving = state.moveFeedToFolder(moved, null);

    expect(ctx.requestUrl(before)).toBe(`/api/feeds/${moved.id}`);
    move.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await nextTask();
    solid.flush();
    expect(state.rowIds()).toEqual([movedItem.id, staysItem.id]);

    await transition.runUpdate();
    solid.flush();
    expect(state.rowIds()).toEqual([staysItem.id]);

    await vi.waitFor(() => expect(transition.started).toBe(2));
    await transition.runUpdate();
    await expect(moving).resolves.toBe(false);
    solid.flush();
    expect(state.rowIds()).toEqual([movedItem.id, staysItem.id]);
  });
});

describe('overlapping animated changes', () => {
  it('restores the original folder when a second move starts before the first rollback update runs and both fail', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    const transition = deferTransitions();
    const other = uuid(97);
    const firstMove = ctx.pending();
    const movingOut = state.moveFeedToFolder(moved, null);
    await transition.runUpdate();
    firstMove.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await vi.waitFor(() => expect(transition.started).toBe(2));
    expect(state.feeds().find(({ id }) => id === moved.id)?.folderId).toBe(
      folderId
    );

    const secondMove = ctx.pending();
    const movingAgain = state.moveFeedToFolder(moved, other);
    // The rows are already hidden, so only the first rollback's update is pending; it must follow
    // the newer move instead of restoring the old folder.
    await transition.runUpdate();
    solid.flush();
    expect(state.rowIds()).toEqual([staysItem.id]);

    secondMove.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await vi.waitFor(() => expect(transition.started).toBe(3));
    await transition.runUpdate();
    await Promise.all([movingOut, movingAgain]);
    solid.flush();
    expect(state.rowIds()).toEqual([movedItem.id, staysItem.id]);
    expect(state.feeds().find(({ id }) => id === moved.id)?.folderId).toBe(
      folderId
    );
  });
});

describe('stale folder rollback', () => {
  it('keeps the rows hidden when a newer move settled before the first rollback update runs', async () => {
    const { state, solid } = ctx;
    await loadFolder();
    const transition = deferTransitions();
    const firstMove = ctx.pending();
    const movingOut = state.moveFeedToFolder(moved, null);
    await transition.runUpdate();
    firstMove.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await vi.waitFor(() => expect(transition.started).toBe(2));

    ctx.queueEmpty();
    await expect(state.moveFeedToFolder(moved, null)).resolves.toBe(true);
    await transition.runUpdate();
    await movingOut;
    solid.flush();
    expect(state.rowIds()).toEqual([staysItem.id]);
    expect(state.feeds().find(({ id }) => id === moved.id)?.folderId).toBe(
      null
    );
  });
});
