import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  link,
  listRequests,
  makeTest,
  page,
  runLoad,
} from './reading-link-fixtures';

describe('infinite page accumulation', () => {
  it('loads with the unread scope and advances a stable cursor', async () => {
    const first = [link(1), link(2)];
    const second = [link(2), link(3)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, true), page(second, false)],
    });
    try {
      await runLoad(registry, atoms, true);
      const firstState = registry.get(atoms.state);
      expect(firstState.items).toEqual(first);
      expect(firstState.hasMore).toBe(true);
      expect(firstState.cursor).toEqual({
        before: first[1]?.createdAt,
        beforeKey: first[1]?.key,
      });
      const [initial] = listRequests(requests);
      expect(initial?.params.get('read')).toBe('false');
      expect(initial?.params.get('all')).toBe('false');
      expect(initial?.params.get('offset')).toBe('0');
      expect(initial?.params.get('before')).toBeNull();
      await runLoad(registry, atoms, false);
      const next = listRequests(requests)[1];
      expect(next?.params.get('before')).toBe(first[1]?.createdAt);
      expect(next?.params.get('beforeKey')).toBe(first[1]?.key);
      expect(registry.get(atoms.state).items.map((item) => item.key)).toEqual([
        first[0]?.key,
        first[1]?.key,
        second[1]?.key,
      ]);
      expect(registry.get(atoms.state).hasMore).toBe(false);
      expect(listRequests(requests)).toHaveLength(2);
    } finally {
      registry.dispose();
    }
  });
});

describe('infinite page reset', () => {
  it('resets from the top when the only-unread filter is disabled', async () => {
    const first = [link(1), link(2)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, false)],
    });
    try {
      await runLoad(registry, atoms, true);
      registry.set(atoms.query, false);
      await runLoad(registry, atoms, true);
      const last = listRequests(requests)[1];
      expect(last?.params.get('read')).toBe('false');
      expect(last?.params.get('all')).toBe('true');
      expect(last?.params.get('offset')).toBe('0');
      expect(last?.params.get('before')).toBeNull();
      expect(last?.params.get('beforeKey')).toBeNull();
      expect(registry.get(atoms.state).items).toEqual(first);
    } finally {
      registry.dispose();
    }
  });
});

describe('infinite page retry', () => {
  it('retries a failed first page without clearing its error early', async () => {
    const first = [link(1)];
    const { registry, atoms, requests } = makeTest({
      pages: [page(first, false)],
      failListOnce: true,
    });
    try {
      const failed = await runLoad(registry, atoms, true);
      expect(Exit.isFailure(failed)).toBe(true);
      expect(registry.get(atoms.state).error).toBe('操作失败，请稍后重试');
      expect(registry.get(atoms.state).loading).toBe(false);
      await runLoad(registry, atoms, true);
      expect(registry.get(atoms.state).error).toBeUndefined();
      expect(registry.get(atoms.state).items).toEqual(first);
      expect(listRequests(requests)).toHaveLength(2);
    } finally {
      registry.dispose();
    }
  });
});
