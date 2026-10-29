import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  article,
  articleRequests,
  feed,
  makeTest,
  page,
  runCommand,
  runLoad,
  settle,
} from './feed-fixtures';

describe('feed infinite pages', () => {
  it('loads the selected feed with a published-time cursor', async () => {
    const first = [article(1), article(2)];
    const second = [article(2), article(3)];
    const { registry, atoms, requests } = makeTest([
      page(first, true),
      page(second, false),
    ]);
    try {
      registry.set(atoms.query, { feedKey: 'feed', onlyUnread: true });
      await runLoad(registry, atoms, true);
      const initial = articleRequests(requests)[0];
      expect(initial?.params.get('feedKey')).toBe('feed');
      expect(initial?.params.get('read')).toBe('false');
      expect(initial?.params.get('all')).toBe('false');
      expect(initial?.params.get('offset')).toBe('0');
      expect(initial?.params.get('before')).toBeNull();
      await runLoad(registry, atoms, false);
      const next = articleRequests(requests)[1];
      expect(next?.params.get('before')).toBe(first[1]?.publishedAt);
      expect(next?.params.get('beforeKey')).toBe(first[1]?.key);
      expect(
        registry.get(atoms.articles).items.map((item) => item.key)
      ).toEqual([first[0]?.key, first[1]?.key, second[1]?.key]);
      expect(registry.get(atoms.articles).hasMore).toBe(false);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed infinite reset', () => {
  it('resets the cursor when only-unread is disabled', async () => {
    const first = [article(1)];
    const { registry, atoms, requests } = makeTest([page(first, false)]);
    try {
      await runLoad(registry, atoms, true);
      registry.set(atoms.query, { feedKey: '', onlyUnread: false });
      await runLoad(registry, atoms, true);
      const last = articleRequests(requests)[1];
      expect(last?.params.get('feedKey')).toBe('');
      expect(last?.params.get('all')).toBe('true');
      expect(last?.params.get('before')).toBeNull();
      expect(last?.params.get('beforeKey')).toBeNull();
    } finally {
      registry.dispose();
    }
  });
});

describe('feed marks', () => {
  it('marks articles without refetching feeds or the article page', async () => {
    const first = [article(1)];
    const key = first[0]?.key ?? '';
    const { registry, atoms, requests } = makeTest([page(first, false)]);
    try {
      await runLoad(registry, atoms, true);
      const loaded = requests.length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Mark',
        key,
        read: true,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(
        requests.filter((request) => request.method === 'GET')
      ).toHaveLength(loaded);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/feeds/articles',
          body: { key, read: true },
        })
      );
    } finally {
      registry.dispose();
    }
  });
});

describe('feed all refresh', () => {
  it('syncs feeds and reloads the current list without RSS refreshes', async () => {
    const alpha = 'a'.repeat(64);
    const beta = 'b'.repeat(64);
    const { registry, atoms, requests } = makeTest(
      [page([], false)],
      [feed(alpha), feed(beta)]
    );
    try {
      await runLoad(registry, atoms, true);
      const exit = await runCommand(registry, atoms, {
        _tag: 'RefreshAll',
        reload: true,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      await settle();
      expect(
        requests.filter((request) => request.path === '/api/feeds/refresh')
      ).toHaveLength(0);
      expect(
        requests.filter(
          (request) => request.method === 'GET' && request.path === '/api/feeds'
        ).length
      ).toBeGreaterThan(1);
      expect(articleRequests(requests)).toHaveLength(2);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed scoped refresh', () => {
  it('syncs counts without reloading a list outside this view', async () => {
    const alpha = 'a'.repeat(64);
    const { registry, atoms, requests } = makeTest(
      [page([], false)],
      [feed(alpha)]
    );
    try {
      await runLoad(registry, atoms, true);
      const loaded = articleRequests(requests).length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Refresh',
        key: alpha,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      await settle();
      expect(articleRequests(requests)).toHaveLength(loaded);
      expect(
        requests.filter((request) => request.path === '/api/feeds/refresh')
      ).toHaveLength(0);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed all-feed bulk marks', () => {
  it('marks all feeds with an empty feed key and clears unread articles', async () => {
    const first = [article(1), article(2, 'other')];
    const { registry, atoms, requests } = makeTest([page(first, true)]);
    try {
      await runLoad(registry, atoms, true);
      const exit = await runCommand(registry, atoms, {
        _tag: 'MarkAll',
        key: '',
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/feeds/articles/mark-all',
          body: { feedKey: '' },
        })
      );
      expect(registry.get(atoms.articles).items).toEqual([]);
      expect(registry.get(atoms.articles).hasMore).toBe(false);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed scoped bulk marks', () => {
  it('keeps other feeds while marking a scoped feed from all articles', async () => {
    const first = [article(1, 'feed'), article(2, 'other')];
    const { registry, atoms } = makeTest([page(first, true)]);
    try {
      await runLoad(registry, atoms, true);
      await runCommand(registry, atoms, { _tag: 'MarkAll', key: 'feed' });
      expect(
        registry.get(atoms.articles).items.map((item) => item.feedKey)
      ).toEqual(['other']);
      expect(registry.get(atoms.articles).hasMore).toBe(true);
    } finally {
      registry.dispose();
    }
  });
});
