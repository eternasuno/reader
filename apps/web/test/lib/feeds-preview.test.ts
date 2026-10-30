import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  article,
  articleRequests,
  feed,
  makeTest,
  page,
  type Request,
  runCommand,
  runLoad,
  runPreview,
} from './feed-fixtures';

const successValue = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error('expected success');

  return exit.value;
};

const feedListReads = (requests: readonly Request[]) =>
  requests.filter(
    (request) => request.method === 'GET' && request.path === '/api/feeds'
  ).length;

const previewReads = (requests: readonly Request[]) =>
  requests.filter((request) => request.path === '/api/feeds/preview').length;

describe('feed preview', () => {
  it('does not change articles or feed counts', async () => {
    const first = [article(1)];
    const { registry, atoms, requests } = makeTest(
      [page(first, false)],
      [feed('a'.repeat(64))]
    );
    try {
      await runLoad(registry, atoms, true);
      const articles = registry.get(atoms.articles);
      const articleReads = articleRequests(requests).length;
      const feeds = feedListReads(requests);
      const url = 'https://example.com/feed.xml';
      const preview = successValue(await runPreview(registry, atoms, url));
      expect(preview).toEqual({
        token: 'preview-token',
        url,
        title: 'Preview title',
        description: 'Preview description',
        articleCount: 2,
      });
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/feeds/preview',
          body: { url },
        })
      );
      expect(registry.get(atoms.articles)).toBe(articles);
      expect(articleRequests(requests)).toHaveLength(articleReads);
      expect(feedListReads(requests)).toBe(feeds);
    } finally {
      registry.dispose();
    }
  });
});

describe('feed preview confirmation', () => {
  it('subscribes with the confirmed preview token', async () => {
    const { registry, atoms, requests } = makeTest([page([], false)]);
    try {
      const preview = successValue(
        await runPreview(registry, atoms, 'https://example.com/feed.xml')
      );
      successValue(
        await runCommand(registry, atoms, {
          _tag: 'Subscribe',
          token: preview.token,
        })
      );
      expect(requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/feeds',
          body: { token: 'preview-token' },
        })
      );
      expect(previewReads(requests)).toBe(1);
    } finally {
      registry.dispose();
    }
  });
});
