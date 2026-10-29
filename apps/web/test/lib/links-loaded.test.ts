import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import { MARK_LOADED_CHUNK_SIZE } from '../../src/lib/mark-loaded';
import {
  deferred,
  link,
  listRequests,
  makeTest,
  page,
  runLoad,
  startCommand,
} from './reading-link-fixtures';

describe('reading-list loaded marks', () => {
  it('marks the loaded snapshot and keeps the rows in place', async () => {
    const first = [link(1), link(2)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, false)],
    });
    try {
      await runLoad(registry, atoms, true);
      const loaded = listRequests(requests).length;
      const exit = await startCommand(registry, atoms, {
        _tag: 'MarkLoaded',
        keys: [first[0]?.key ?? ''],
        generation: registry.get(atoms.state).generation,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(listRequests(requests)).toHaveLength(loaded);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/links/mark-loaded',
          body: { keys: [first[0]?.key] },
        })
      );
      const state = registry.get(atoms.state);
      expect(state.items.map((item) => item.key)).toEqual([
        first[0]?.key,
        first[1]?.key,
      ]);
      expect(state.items.map((item) => item.read)).toEqual([true, false]);
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list partial loaded marks', () => {
  it('keeps failed chunks unread and surfaces the partial error', async () => {
    const items = Array.from(
      { length: MARK_LOADED_CHUNK_SIZE + 1 },
      (_, index) => link(index + 1)
    );
    const failedKey = items[MARK_LOADED_CHUNK_SIZE]?.key ?? '';
    const { registry, atoms } = makeTest({
      pages: [page(items, false)],
      markLoaded: (keys) =>
        keys.includes(failedKey)
          ? Response.json({ error: '暂时无法标记' }, { status: 500 })
          : Response.json({ ok: true }),
    });
    try {
      await runLoad(registry, atoms, true);
      const exit = await startCommand(registry, atoms, {
        _tag: 'MarkLoaded',
        keys: items.map((item) => item.key),
        generation: registry.get(atoms.state).generation,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      if (!Exit.isSuccess(exit)) return;
      const result = exit.value;

      expect(result?.failed).toBe(true);
      expect(result?.error).not.toBe('');
      expect(result?.keys).toHaveLength(MARK_LOADED_CHUNK_SIZE);
      expect(result?.keys).not.toContain(failedKey);
      const state = registry.get(atoms.state);
      expect(
        state.items.slice(0, MARK_LOADED_CHUNK_SIZE).every((item) => item.read)
      ).toBe(true);
      expect(state.items[MARK_LOADED_CHUNK_SIZE]?.key).toBe(failedKey);
      expect(state.items[MARK_LOADED_CHUNK_SIZE]?.read).toBe(false);
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list incoming rows', () => {
  it('leaves rows loaded during the operation unread', async () => {
    const first = [link(1)];
    const second = [link(2)];
    const gate = deferred();
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, true), page(second, false)],
      markLoaded: async () => {
        await gate.promise;

        return Response.json({ ok: true });
      },
    });
    try {
      await runLoad(registry, atoms, true);
      const generation = registry.get(atoms.state).generation;
      const commandExit = startCommand(registry, atoms, {
        _tag: 'MarkLoaded',
        keys: [first[0]?.key ?? ''],
        generation,
      });
      await runLoad(registry, atoms, false);
      const loaded = listRequests(requests).length;
      gate.resolve();
      expect(Exit.isSuccess(await commandExit)).toBe(true);
      expect(listRequests(requests)).toHaveLength(loaded);
      const state = registry.get(atoms.state);
      expect(state.items.map((item) => item.key)).toEqual([
        first[0]?.key,
        second[0]?.key,
      ]);
      expect(state.items.map((item) => item.read)).toEqual([true, false]);
      expect(state.generation).toBe(generation);
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list stale loaded marks', () => {
  it('does not project a stale snapshot onto a reloaded scope', async () => {
    const first = [link(1)];
    const replacement = [link(2)];
    const gate = deferred();
    const { registry, atoms } = makeTest({
      pages: [page(first, false), page(replacement, false)],
      markLoaded: async () => {
        await gate.promise;

        return Response.json({ ok: true });
      },
    });
    try {
      await runLoad(registry, atoms, true);
      const staleGeneration = registry.get(atoms.state).generation;
      const commandExit = startCommand(registry, atoms, {
        _tag: 'MarkLoaded',
        keys: [first[0]?.key ?? ''],
        generation: staleGeneration,
      });
      await runLoad(registry, atoms, true);
      gate.resolve();
      expect(Exit.isSuccess(await commandExit)).toBe(true);
      const state = registry.get(atoms.state);
      expect(state.generation).toBeGreaterThan(staleGeneration);
      expect(state.items.map((item) => item.key)).toEqual([
        replacement[0]?.key,
      ]);
      expect(state.items.map((item) => item.read)).toEqual([false]);
    } finally {
      registry.dispose();
    }
  });
});
