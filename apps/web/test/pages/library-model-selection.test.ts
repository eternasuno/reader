// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { type Article, LibraryError } from '../../src/lib/library';
import { createLibraryModel } from '../../src/pages/library-model';
import {
  article,
  createStubClient,
  deferred,
  feed,
  page,
  preview,
} from './library-fixtures';

const withRows = async (
  rows = [article('a', { feedId: 'f1' }), article('b')]
) => {
  const client = createStubClient();
  client.list.mockResolvedValue(page(rows, null, 'top'));
  client.laterUnread.mockResolvedValue(0);
  client.feedUnread.mockResolvedValue({ total: 1, feeds: { f1: 1 } });
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
    expect(client.markRead).toHaveBeenCalledWith('a', true);
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
    expect(client.markRead.mock.calls).toEqual([
      ['a', true],
      ['a', false],
      ['a', true],
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
});

describe('library subscriptions', () => {
  it('selects the duplicate feed reported by the error id', async () => {
    const client = createStubClient();
    client.feeds.mockResolvedValue([feed('f-other')]);
    client.list.mockResolvedValue(page([], null, 'top'));
    client.subscribe.mockRejectedValue(
      new LibraryError('SubscriptionExists', { id: 'f-existing' })
    );
    const model = createLibraryModel(client);

    expect(await model.subscribe('https://example.com/f-other.xml')).toBe(true);

    expect(model.state().scope).toEqual({
      kind: 'feeds',
      feedId: 'f-existing',
    });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f-existing' },
      'all'
    );
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '该订阅已存在',
    });
  });

  it('selects the new subscription and keeps the feeds sorted', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([], null, 'top'));
    client.feeds.mockResolvedValue([feed('f-c')]);
    client.subscribe.mockResolvedValue(feed('f-a'));
    const model = createLibraryModel(client);
    await model.refresh();

    expect(await model.subscribe('https://example.com/f-a.xml')).toBe(true);

    expect(model.state().feeds.map((item) => item.id)).toEqual(['f-a', 'f-c']);
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f-a' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f-a' },
      'all'
    );
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '订阅已添加',
    });
  });

  it('selects the kept feed when the initial import fails', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([], null, 'top'));
    client.feeds.mockResolvedValue([feed('kept')]);
    client.subscribe.mockRejectedValue(
      new LibraryError('SubscriptionImportFailed', { id: 'kept' })
    );
    const model = createLibraryModel(client);

    expect(await model.subscribe('https://example.com/kept.xml')).toBe(true);

    expect(model.state().feeds.map((item) => item.id)).toEqual(['kept']);
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'kept' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'kept' },
      'all'
    );
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '订阅文章导入失败，请稍后重试',
    });
  });

  it('keeps the current scope when the subscription fails', async () => {
    const client = createStubClient();
    client.subscribe.mockRejectedValue(
      new LibraryError('FetchSubscriptionError')
    );
    const model = createLibraryModel(client);

    expect(await model.subscribe('https://example.com/x.xml')).toBe(false);

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

  it('selects an existing subscription reported by the preview', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([], null, 'top'));
    client.feeds.mockResolvedValue([feed('existing')]);
    client.preview.mockRejectedValue(
      new LibraryError('SubscriptionExists', { id: 'existing' })
    );
    const model = createLibraryModel(client);

    expect(await model.preview('https://example.com/existing.xml')).toEqual({
      kind: 'existing',
    });

    expect(model.state().feeds.map((item) => item.id)).toEqual(['existing']);
    expect(model.state().scope).toEqual({
      kind: 'feeds',
      feedId: 'existing',
    });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'existing' },
      'all'
    );
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '该订阅已存在',
    });
  });
});
