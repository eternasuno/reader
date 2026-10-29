import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  article,
  articleRequests,
  deferred,
  makeTest,
  page,
  runLoad,
  startCommand,
} from './feed-fixtures';

const expectSnapshotState = (
  state: {
    readonly items: readonly {
      readonly key: string;
      readonly read: boolean;
    }[];
    readonly hasMore: boolean;
    readonly generation: number;
  },
  keys: readonly string[],
  reads: readonly boolean[],
  generation: number
) => {
  expect(state.items.map((item) => item.key)).toEqual(keys);
  expect(state.items.map((item) => item.read)).toEqual(reads);
  expect(state.hasMore).toBe(false);
  expect(state.generation).toBe(generation);
};

describe('feed loaded marks', () => {
  it('marks only the snapshot keys and keeps incoming rows unread', async () => {
    const first = [article(1), article(2)];
    const second = [article(3)];
    const gate = deferred();
    const { registry, atoms, requests } = makeTest(
      [page(first, true), page(second, false)],
      [],
      {
        markLoaded: async () => {
          await gate.promise;

          return Response.json({ ok: true });
        },
      }
    );
    try {
      await runLoad(registry, atoms, true);
      const generation = registry.get(atoms.articles).generation;
      const commandExit = startCommand(registry, atoms, {
        _tag: 'MarkLoaded',
        keys: [first[0]?.key ?? ''],
        generation,
      });
      await runLoad(registry, atoms, false);
      const loaded = articleRequests(requests).length;
      gate.resolve();
      const exit = await commandExit;
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(articleRequests(requests)).toHaveLength(loaded);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/feeds/articles/mark-loaded',
          body: { keys: [first[0]?.key] },
        })
      );
      const state = registry.get(atoms.articles);
      expectSnapshotState(
        state,
        [first[0]?.key ?? '', first[1]?.key ?? '', second[0]?.key ?? ''],
        [true, false, false],
        generation
      );
    } finally {
      registry.dispose();
    }
  });
});
