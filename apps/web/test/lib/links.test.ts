import { Effect, Exit } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import {
  link,
  listRequests,
  makeTest,
  page,
  runCommand,
  runLoad,
} from './reading-link-fixtures';

describe('reading-list unread counts', () => {
  it('loads the backend total independently of loaded items', async () => {
    const { registry, atoms } = makeTest();
    try {
      registry.mount(atoms.unread);
      const result = await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.unread, {
          suspendOnWaiting: true,
        })
      );
      expect(result).toEqual({ count: 7 });
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list marks', () => {
  it('marks without refetching loaded pages', async () => {
    const first = [link(1)];
    const key = first[0]?.key ?? '';
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, true)],
    });
    try {
      await runLoad(registry, atoms, true);
      const loaded = listRequests(requests).length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Mark',
        key,
        read: true,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(listRequests(requests)).toHaveLength(loaded);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/links',
          body: { key, read: true },
        })
      );
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list mark failures', () => {
  it('keeps mark failures out of list state without refetching', async () => {
    const { registry, atoms, requests } = makeTest({ markStatus: 404 });
    try {
      await runLoad(registry, atoms, true);
      const loaded = listRequests(requests).length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Mark',
        key: link(1).key,
        read: true,
      });
      expect(Exit.isFailure(exit)).toBe(true);
      expect(listRequests(requests)).toHaveLength(loaded);
      expect(registry.get(atoms.state).items).toEqual([]);
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list unread bulk marks', () => {
  it('marks the complete unread scope and clears the loaded list', async () => {
    const first = [link(1), link(2)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, true)],
    });
    try {
      registry.mount(atoms.unread);
      await runLoad(registry, atoms, true);
      const exit = await runCommand(registry, atoms, { _tag: 'MarkAll' });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/links/mark-all',
          body: {},
        })
      );
      expect(registry.get(atoms.state).items).toEqual([]);
      expect(registry.get(atoms.state).hasMore).toBe(false);
      const unread = await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.unread, {
          suspendOnWaiting: true,
        })
      );
      expect(unread).toEqual({ count: 0 });
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list full bulk marks', () => {
  it('projects read state onto loaded items in the full scope', async () => {
    const first = [link(1), link(2)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, true)],
    });
    try {
      registry.set(atoms.query, false);
      await runLoad(registry, atoms, true);
      const exit = await runCommand(registry, atoms, { _tag: 'MarkAll' });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(registry.get(atoms.state).items.map((item) => item.read)).toEqual([
        true,
        true,
      ]);
      expect(listRequests(requests)).toHaveLength(1);
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list failures', () => {
  it('keeps typed API failures isolated between registries', async () => {
    const first = makeTest();
    const second = makeTest();
    try {
      first.registry.set(first.atoms.command, {
        _tag: 'Add',
        url: 'https://example.com/',
      });
      const exit = await Effect.runPromiseExit(
        AtomRegistry.getResult(first.registry, first.atoms.command, {
          suspendOnWaiting: true,
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(second.registry.get(second.atoms.query)).toBe(true);
    } finally {
      first.registry.dispose();
      second.registry.dispose();
    }
  });
});
