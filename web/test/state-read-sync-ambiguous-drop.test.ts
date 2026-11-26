import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeDeferredWrites } from './support/mark-all-routes';
import { createStateTestContext, makePage } from './support/state-fixture';

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
      items: [makePage({ id: 'p1', read: false })],
      feeds: [],
      saved: 1,
    });
    const routed = routeDeferredWrites(ctx.fetchMock);
    const older = readSync.beginRecordSnapshot();

    const toggle = state.toggleArticleRead('p1', true);
    solid.flush();
    await vi.waitFor(() => expect(routed.count('/api/saved-pages/p1')).toBe(1));

    ctx.queue({
      items: [makePage({ id: 'p2', read: true })],
      cursor: null,
      boundary: BOUNDARY,
    });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p2']);

    routed.rejectNext('/api/saved-pages/p1');
    await expect(toggle).resolves.toBe(false);
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));

    const incoming = {
      ...makePage({ id: 'p1', read: true }),
      kind: 'later' as const,
    };
    expect(readSync.mergeSnapshotRead(incoming, older.seq)).toBe(true);
    older.release();
  });
});
