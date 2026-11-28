import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeDeferredWrites } from './support/mark-all-routes';
import {
  createStateTestContext,
  makePage,
  savedOrder,
  uuid,
} from './support/state-fixture';

const BOUNDARY = '019363b8-0000-7000-8000-000000000002';

type ReadSyncMod = typeof import('../src/state/read-sync');

const ctx = createStateTestContext();
let readSync: ReadSyncMod;

beforeEach(async () => {
  await ctx.reset();
  readSync = await import('../src/state/read-sync');
});

describe('read sync: ambiguous failure outside the store', () => {
  it('drops the idle unknown entry at drain so a later snapshot restores the server value', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: false })],
      feeds: [],
      saved: 1,
    });
    const routed = routeDeferredWrites(ctx.fetchMock);
    const older = readSync.beginRecordSnapshot();

    const toggle = state.toggleArticleRead(uuid(1018), true);
    solid.flush();
    await vi.waitFor(() =>
      expect(routed.count(`/api/saved-pages/${uuid(1018)}`)).toBe(1)
    );

    const items = [makePage({ id: uuid(1019), read: true })];
    ctx.queue(savedOrder(items, BOUNDARY));
    ctx.queue({ items });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(state.rowIds()).toEqual([uuid(1019)]);

    routed.rejectNext(`/api/saved-pages/${uuid(1018)}`);
    await expect(toggle).resolves.toBe(false);
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));

    const incoming = {
      ...makePage({ id: uuid(1018), read: true }),
      kind: 'later' as const,
    };
    expect(readSync.mergeSnapshotRead(incoming, older.seq)).toBe(true);
    older.release();
  });
});
