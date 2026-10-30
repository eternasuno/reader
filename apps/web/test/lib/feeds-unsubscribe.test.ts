import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  article,
  articleRequests,
  deferred,
  feed,
  makeTest,
  page,
  runCommand,
  runLoad,
  settle,
  startCommand,
} from './feed-fixtures';

describe('feed unsubscribe selection', () => {
  it('keeps the selected feed and its page scope when another feed is deleted', async () => {
    const alpha = 'a'.repeat(64);
    const beta = 'b'.repeat(64);
    const first = [article(1, alpha)];
    const { registry, atoms, requests } = makeTest(
      [page(first, false)],
      [feed(alpha), feed(beta)]
    );
    try {
      registry.set(atoms.query, { feedKey: alpha, onlyUnread: true });
      await runLoad(registry, atoms, true);
      const loaded = articleRequests(requests).length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Unsubscribe',
        key: beta,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      await settle();
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'DELETE',
          path: '/api/feeds',
          body: { key: beta },
        })
      );
      expect(registry.get(atoms.query).feedKey).toBe(alpha);
      expect(
        articleRequests(requests)
          .slice(loaded)
          .every((request) => request.params.get('feedKey') === alpha)
      ).toBe(true);
      expect(
        registry
          .get(atoms.articles)
          .items.every((item) => item.feedKey === alpha)
      ).toBe(true);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed unsubscribe current feed', () => {
  it('leaves the deleted feed to presentation without fetching it again', async () => {
    const beta = 'b'.repeat(64);
    const first = [article(1, beta)];
    const { registry, atoms, requests } = makeTest(
      [page(first, false)],
      [feed(beta)]
    );
    try {
      registry.set(atoms.query, { feedKey: beta, onlyUnread: true });
      await runLoad(registry, atoms, true);
      const loaded = articleRequests(requests).length;
      const snapshot = registry.get(atoms.articles);
      const exit = await runCommand(registry, atoms, {
        _tag: 'Unsubscribe',
        key: beta,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      await settle();
      expect(registry.get(atoms.query).feedKey).toBe(beta);
      expect(articleRequests(requests)).toHaveLength(loaded);
      expect(registry.get(atoms.articles)).toBe(snapshot);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed unsubscribe pending switch', () => {
  it('does not overwrite a feed selected while deletion is pending', async () => {
    const alpha = 'a'.repeat(64);
    const beta = 'b'.repeat(64);
    const gamma = 'c'.repeat(64);
    const gate = deferred();
    const switched = [article(2, gamma)];
    const { registry, atoms, requests } = makeTest(
      [page([], false), page(switched, false)],
      [feed(alpha), feed(beta), feed(gamma)],
      {
        unsubscribe: async () => {
          await gate.promise;

          return Response.json({ ok: true });
        },
      }
    );
    try {
      registry.set(atoms.query, { feedKey: beta, onlyUnread: true });
      await runLoad(registry, atoms, true);
      const pending = startCommand(registry, atoms, {
        _tag: 'Unsubscribe',
        key: beta,
      });
      await settle();
      registry.set(atoms.query, { feedKey: gamma, onlyUnread: true });
      await runLoad(registry, atoms, true);
      const switchedReads = articleRequests(requests).length;
      gate.resolve();
      expect(Exit.isSuccess(await pending)).toBe(true);
      await settle();
      expect(registry.get(atoms.query).feedKey).toBe(gamma);
      expect(articleRequests(requests)).toHaveLength(switchedReads);
      expect(
        registry.get(atoms.articles).items.map((item) => item.feedKey)
      ).toEqual([gamma]);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed unsubscribe all scope', () => {
  it('reloads all articles after deleting a feed from that scope', async () => {
    const beta = 'b'.repeat(64);
    const { registry, atoms, requests } = makeTest(
      [page([], false)],
      [feed(beta)]
    );
    try {
      await runLoad(registry, atoms, true);
      const loaded = articleRequests(requests).length;
      await runCommand(registry, atoms, { _tag: 'Unsubscribe', key: beta });
      await settle();
      expect(registry.get(atoms.query).feedKey).toBe('');
      expect(articleRequests(requests).length).toBeGreaterThan(loaded);
      expect(articleRequests(requests).at(-1)?.params.get('feedKey')).toBe('');
    } finally {
      registry.dispose();
    }
  });
});

describe('feed subscribe reload', () => {
  it('reloads the current selection after a preview confirmation', async () => {
    const alpha = 'a'.repeat(64);
    const { registry, atoms, requests } = makeTest(
      [page([], false)],
      [feed(alpha)]
    );
    try {
      registry.set(atoms.query, { feedKey: alpha, onlyUnread: true });
      await runLoad(registry, atoms, true);
      const loaded = articleRequests(requests).length;
      const exit = await runCommand(registry, atoms, {
        _tag: 'Subscribe',
        token: 'preview-token',
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      await settle();
      expect(articleRequests(requests).length).toBeGreaterThan(loaded);
      expect(articleRequests(requests).at(-1)?.params.get('feedKey')).toBe(
        alpha
      );
    } finally {
      registry.dispose();
    }
  });
});
