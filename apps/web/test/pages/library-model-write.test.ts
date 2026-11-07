// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped write cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { type Article, LibraryError } from '../../src/lib/library';
import { createLibraryModel } from '../../src/pages/library-model';
import {
  article,
  counts,
  createStubClient,
  deferred,
  feed,
  page,
} from './library-fixtures';

const withRows = async (
  rows = [article('a', { feedId: 'f1' }), article('b')]
) => {
  const client = createStubClient();
  client.list.mockResolvedValue(page(rows, null, 'top'));
  client.unreadCounts.mockResolvedValue(counts(0, { f1: 1 }));
  const model = createLibraryModel(client);
  await model.refresh();

  return { client, model };
};

describe('library bulk read marks', () => {
  it('keeps bulk-marked rows pending through a refresh', async () => {
    const { client, model } = await withRows();
    const mark = deferred<void>();
    client.markArticles.mockReturnValue(mark.promise);

    const pending = model.markLoaded();
    expect(model.state().pending.has('a')).toBe(true);
    expect(model.state().pending.has('b')).toBe(true);

    client.refresh.mockResolvedValue([
      article('a', { feedId: 'f1' }),
      article('b'),
    ]);
    await model.refresh();

    expect(model.state().items.every((item) => item.read)).toBe(true);
    expect(model.state().pending.has('a')).toBe(true);

    mark.resolve();
    await pending;

    expect(model.state().pending.size).toBe(0);
  });

  it('reloads counts after a failed bulk mark', async () => {
    const { client, model } = await withRows();
    client.markArticles.mockRejectedValue(
      new LibraryError('FeedItemRepositoryError')
    );
    client.unreadCounts.mockResolvedValue(counts(3, { f1: 1 }));

    await model.markLoaded();

    expect(model.state().items.every((item) => !item.read)).toBe(true);
    expect(model.state().counts.later).toBe(3);
  });

  it('registers mark-all rows pending until the scope write settles', async () => {
    const { client, model } = await withRows();
    client.feeds.mockResolvedValue([feed('f1')]);
    await model.setScope({ kind: 'feeds' });
    const mark = deferred<void>();
    client.markFeeds.mockReturnValue(mark.promise);

    const pending = model.markAll();
    expect(model.state().pending.has('a')).toBe(true);
    expect(model.state().pending.has('b')).toBe(true);

    mark.resolve();
    await pending;

    expect(model.state().pending.size).toBe(0);
  });
});

describe('library read reconciliation', () => {
  it('adopts the final server read state after overlapping marks settle', async () => {
    const { client, model } = await withRows([article('a', { feedId: 'f1' })]);
    const first = deferred<void>();
    const second = deferred<void>();
    client.markRead
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    client.article.mockResolvedValue(
      article('a', { feedId: 'f1', read: true })
    );
    client.unreadCounts.mockResolvedValue(counts(0, { f1: 0 }));
    const row = model.state().items[0] ?? article('a');

    const one = model.toggleRead(row);
    const two = model.toggleRead(model.state().items[0] ?? row);

    second.resolve();
    await two;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    first.resolve();
    await one;

    expect(model.state().items[0]?.read).toBe(true);
    expect(model.state().pending.has('a')).toBe(false);
    // biome-ignore lint/complexity/useLiteralKeys: the counts map is an index signature.
    expect(model.state().counts.feeds['f1']).toBe(0);
  });

  it('keeps a newer mark while an older reconcile is in flight', async () => {
    const { client, model } = await withRows([article('a', { feedId: 'f1' })]);
    const firstMark = deferred<void>();
    const secondMark = deferred<void>();
    const reconcile = deferred<Article | null>();
    client.markRead
      .mockReturnValueOnce(firstMark.promise)
      .mockReturnValueOnce(secondMark.promise);
    client.article.mockReturnValueOnce(reconcile.promise);
    const row = model.state().items[0] ?? article('a');

    const first = model.toggleRead(row);
    firstMark.resolve();
    await Promise.resolve();
    const next = model.toggleRead(model.state().items[0] ?? row);
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    reconcile.resolve(article('a', { feedId: 'f1', read: true }));
    await first;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    secondMark.resolve();
    await next;

    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(false);
  });
});
