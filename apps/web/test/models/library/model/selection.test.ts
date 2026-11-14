// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { type Article, LibraryError } from '../../../../src/api/library';
import { createLibraryModel } from '../../../../src/models/library/model';
import {
  article,
  counts,
  createStubClient,
  deferred,
  feed,
  page,
  preview,
} from '../../../support/library';

const withRows = async (
  rows = [article('a', { feedId: 'f1' }), article('b')]
) => {
  const client = createStubClient();
  client.list.mockResolvedValue(page(rows, null));
  client.unreadCounts.mockResolvedValue(counts(0, { f1: 1 }));
  const model = createLibraryModel(client);
  await model.refresh();

  return { client, model };
};

describe('library open', () => {
  it('shows the snapshot and marks the article read', async () => {
    const { client, model } = await withRows([article('a')]);
    client.article.mockResolvedValue(article('a', { read: true }));

    const opened = await model.openArticle('a');

    expect(opened?.id).toBe('a');
    expect(model.state().selected?.id).toBe('a');
    expect(client.markRead).not.toHaveBeenCalled();
  });

  it('keeps the snapshot when the article is gone and marks it read', async () => {
    const { client, model } = await withRows([article('a')]);
    client.article.mockResolvedValue(null);

    const opened = await model.openArticle('a');

    expect(opened?.id).toBe('a');
    expect(model.state().selected?.title).toBe('Article a');
    expect(client.markRead).toHaveBeenCalledWith(
      { id: 'a', feedId: undefined },
      true
    );
    expect(model.state().items[0]?.read).toBe(true);
  });

  it('re-selects and re-marks a reopened article read', async () => {
    const { client, model } = await withRows([article('a', { feedId: 'f1' })]);
    client.article.mockResolvedValue(null);
    await model.openArticle('a');
    expect(model.state().items[0]?.read).toBe(true);

    model.clearSelection();
    await model.toggleRead(model.state().items[0] ?? article('a'));
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().selected).toBeUndefined();

    const reopened = await model.openArticle('a');

    expect(reopened?.id).toBe('a');
    expect(model.state().selected?.id).toBe('a');
    expect(model.state().items[0]?.read).toBe(true);
    const ref = { id: 'a', feedId: 'f1' };
    expect(client.markRead.mock.calls).toEqual([
      [ref, true],
      [ref, false],
      [ref, true],
    ]);
  });

  it('clears the selection when the routed article cannot be found', async () => {
    const { client, model } = await withRows();
    client.article.mockResolvedValue(null);
    await model.openArticle('a');
    expect(model.state().selected?.id).toBe('a');

    const missing = await model.openArticle('missing');

    expect(missing).toBeUndefined();
    expect(model.state().selected).toBeUndefined();
  });

  it('keeps the newer selection when an older open resolves late', async () => {
    const { client, model } = await withRows();
    const older = deferred<Article | null>();
    const newer = deferred<Article | null>();
    client.article
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const first = model.openArticle('a');
    const second = model.openArticle('b');
    newer.resolve({ ...article('b', { read: true }), title: 'Server b' });
    await second;
    older.resolve({ ...article('a', { read: true }), title: 'Server a' });
    await first;

    expect(model.state().selected?.id).toBe('b');
    expect(model.state().items.find((item) => item.id === 'a')?.title).toBe(
      'Article a'
    );
  });

  it('ignores a late open after the selection is cleared', async () => {
    const { client, model } = await withRows([article('a')]);
    const response = deferred<Article | null>();
    client.article.mockReturnValueOnce(response.promise);

    const opened = model.openArticle('a');
    model.clearSelection();
    response.resolve({ ...article('a', { read: true }), title: 'Server a' });
    await opened;

    expect(model.state().selected).toBeUndefined();
    expect(model.state().items[0]?.title).toBe('Article a');
  });

  it('keeps an article opened from the unread list listed as read', async () => {
    const { client, model } = await withRows([article('a')]);
    await model.setFilter(true);
    client.article.mockResolvedValue(null);

    await model.openArticle('a');

    expect(model.state().items.map((item) => [item.id, item.read])).toEqual([
      ['a', true],
    ]);
  });
});

describe('library subscriptions', () => {
  it('subscribes with the previewed url and title and selects the new feed', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([]));
    client.feeds.mockResolvedValue([feed('f-c')]);
    client.subscribe.mockResolvedValue(feed('f-a'));
    const model = createLibraryModel(client);
    await model.refresh();

    expect(
      await model.subscribe('https://example.com/f-a.xml', 'Feed f-a')
    ).toBe(true);

    expect(client.subscribe).toHaveBeenCalledWith(
      'https://example.com/f-a.xml',
      'Feed f-a'
    );
    expect(model.state().feeds.map((item) => item.id)).toEqual(['f-a', 'f-c']);
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f-a' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f-a' },
      false
    );
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '订阅已添加',
    });
  });

  it('selects the loaded feed whose url the error names', async () => {
    const client = createStubClient();
    client.feeds.mockResolvedValue([
      feed('f-other'),
      feed('f-existing', 'https://example.com/existing.xml'),
    ]);
    client.list.mockResolvedValue(page([]));
    client.subscribe.mockRejectedValue(
      new LibraryError('FeedAlreadyExists', {
        url: 'https://example.com/existing.xml',
      })
    );
    const model = createLibraryModel(client);
    await model.refresh();

    expect(
      await model.subscribe('https://example.com/existing.xml', 'Existing')
    ).toBe(true);

    expect(client.feeds).toHaveBeenCalledTimes(1);
    expect(model.state().scope).toEqual({
      kind: 'feeds',
      feedId: 'f-existing',
    });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f-existing' },
      false
    );
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '该订阅已存在',
    });
  });

  it('reloads the feed list once when the existing feed is not loaded', async () => {
    const client = createStubClient();
    client.feeds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([feed('f-x', 'https://example.com/x.xml')]);
    client.list.mockResolvedValue(page([]));
    client.subscribe.mockRejectedValue(
      new LibraryError('FeedAlreadyExists', {
        url: 'https://example.com/x.xml',
      })
    );
    const model = createLibraryModel(client);
    await model.refresh();

    expect(await model.subscribe('https://example.com/x.xml', 'X')).toBe(true);

    expect(client.feeds).toHaveBeenCalledTimes(2);
    expect(model.state().feeds.map((item) => item.id)).toEqual(['f-x']);
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f-x' });
  });

  it('keeps the current scope when the subscription fails', async () => {
    const client = createStubClient();
    client.subscribe.mockRejectedValue(new LibraryError('FetchFeedError'));
    const model = createLibraryModel(client);

    expect(await model.subscribe('https://example.com/x.xml', 'X')).toBe(false);

    expect(model.state().scope).toEqual({ kind: 'later' });
    expect(client.list).not.toHaveBeenCalled();
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '无法获取订阅内容，请稍后重试',
    });
  });

  it('returns the preview without changing the scope', async () => {
    const client = createStubClient();
    const model = createLibraryModel(client);

    expect(await model.preview('https://example.com/feed.xml')).toEqual({
      kind: 'preview',
      preview,
    });

    expect(model.state().scope).toEqual({ kind: 'later' });
    expect(client.list).not.toHaveBeenCalled();
    expect(model.state().toast).toBeUndefined();
  });
});
