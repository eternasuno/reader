// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { type ArticlePage, LibraryError } from '../../src/lib/library';
import { createLibraryModel } from '../../src/pages/library-model';
import {
  article,
  counts,
  createStubClient,
  deferred,
  feed,
  newerArticle,
  page,
} from './library-fixtures';

describe('library initial load', () => {
  it('loads the first page with subscriptions and unread counts', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], 'cursor-1'));
    client.feeds.mockResolvedValue([feed('f1')]);
    client.unreadCounts.mockResolvedValue(counts(1, { f1: 0 }));
    const model = createLibraryModel(client);

    await model.refresh();

    expect(client.list).toHaveBeenCalledWith({ kind: 'later' }, 'all');
    expect(model.state()).toMatchObject({
      initialized: true,
      loading: false,
      cursor: 'cursor-1',
      hasMore: true,
    });
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);
    expect(model.state().feeds).toEqual([feed('f1')]);
    expect(model.state().counts).toEqual(counts(1, { f1: 0 }));
    expect(client.unreadCounts).toHaveBeenCalledTimes(1);
    expect(model.state().error).toBeUndefined();
  });

  it('keeps loaded data when feeds or counts fail', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], null));
    client.feeds.mockRejectedValue(new LibraryError('FeedRepositoryError'));
    client.unreadCounts.mockRejectedValue(
      new LibraryError('FeedItemRepositoryError')
    );
    const model = createLibraryModel(client);

    await model.refresh();

    expect(model.state().items).toHaveLength(1);
    expect(model.state().feeds).toEqual([]);
    expect(model.state().counts).toEqual(counts());
    expect(model.state().error).toBeUndefined();
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问订阅文章，请稍后重试',
    });
  });

  it('keeps the last counts when the combined count request fails', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], null));
    client.unreadCounts.mockResolvedValueOnce(counts(4, { f1: 2 }));
    const model = createLibraryModel(client);

    await model.refresh();
    expect(model.state().counts).toEqual(counts(4, { f1: 2 }));

    client.unreadCounts.mockRejectedValueOnce(
      new LibraryError('FeedItemRepositoryError')
    );
    await model.refresh();

    expect(model.state().counts).toEqual(counts(4, { f1: 2 }));
  });

  it('deduplicates count failure toasts until recovery', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], null));
    client.unreadCounts.mockRejectedValue(
      new LibraryError('FeedItemRepositoryError')
    );
    const model = createLibraryModel(client);

    await model.refresh();
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问订阅文章，请稍后重试',
    });

    model.dismissToast();
    await model.refresh();
    expect(model.state().toast).toBeUndefined();

    client.unreadCounts.mockResolvedValue(counts());
    await model.refresh();
    client.unreadCounts.mockRejectedValue(
      new LibraryError('FeedItemRepositoryError')
    );
    await model.refresh();
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问订阅文章，请稍后重试',
    });
  });
});

describe('library refresh', () => {
  it('reloads the list from the first page', async () => {
    const client = createStubClient();
    client.list
      .mockResolvedValueOnce(page([article('a'), article('b')], 'cursor-1'))
      .mockResolvedValueOnce(
        page([newerArticle('n'), article('a')], 'cursor-2')
      );
    const model = createLibraryModel(client);
    await model.refresh();

    await model.refresh();

    expect(client.list).toHaveBeenCalledTimes(2);
    expect(client.list).toHaveBeenLastCalledWith({ kind: 'later' }, 'all');
    expect(model.state().items.map((item) => item.id)).toEqual(['n', 'a']);
    expect(model.state().cursor).toBe('cursor-2');
    expect(model.state().loading).toBe(false);
  });

  it('keeps the current filter when refreshing', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')]));
    const model = createLibraryModel(client);
    await model.setFilter('unread');

    await model.refresh();

    expect(client.list).toHaveBeenLastCalledWith({ kind: 'later' }, 'unread');
  });

  it('ignores a refresh while a load is in flight', async () => {
    const client = createStubClient();
    const pending = deferred<ArticlePage>();
    client.list.mockReturnValueOnce(pending.promise);
    const model = createLibraryModel(client);

    const first = model.refresh();
    await model.refresh();
    pending.resolve(page([article('a')]));
    await first;

    expect(client.list).toHaveBeenCalledTimes(1);
  });

  it('refreshes an empty first page', async () => {
    const client = createStubClient();
    client.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([article('n')], 'cursor-2'));
    const model = createLibraryModel(client);

    await model.refresh();
    expect(model.state()).toMatchObject({
      initialized: true,
      loading: false,
      items: [],
    });

    await model.refresh();

    expect(model.state().items.map((item) => item.id)).toEqual(['n']);
    expect(model.state().cursor).toBe('cursor-2');
    expect(model.state().loading).toBe(false);
  });
});

describe('library paging', () => {
  it('retries the same cursor after a load failure', async () => {
    const client = createStubClient();
    client.list
      .mockResolvedValueOnce(page([article('a')], 'cursor-1'))
      .mockRejectedValueOnce(new LibraryError('FeedItemRepositoryError'))
      .mockResolvedValueOnce(page([article('b')], null));
    const model = createLibraryModel(client);
    await model.refresh();

    await model.loadMore();
    expect(model.state().error).toBe('暂时无法访问订阅文章，请稍后重试');
    expect(model.state().cursor).toBe('cursor-1');
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);

    await model.loadMore();
    expect(model.state().error).toBeUndefined();
    expect(model.state().items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(model.state().hasMore).toBe(false);
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'later' },
      'all',
      'cursor-1'
    );
  });

  it('restarts from the first page after an invalid cursor', async () => {
    const client = createStubClient();
    client.list
      .mockResolvedValueOnce(page([article('a')], 'cursor-1'))
      .mockRejectedValueOnce(new LibraryError('InvalidCursor'))
      .mockResolvedValueOnce(page([article('b')], 'cursor-2'));
    const model = createLibraryModel(client);
    await model.refresh();

    await model.loadMore();
    expect(model.state().error).toBe('列表已更新，请刷新后重试');
    expect(model.state().cursor).toBe('cursor-1');
    expect(model.state().cursorInvalid).toBe(true);

    await model.loadMore();

    expect(client.list).toHaveBeenLastCalledWith({ kind: 'later' }, 'all');
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);
    expect(model.state().cursor).toBe('cursor-2');
    expect(model.state().cursorInvalid).toBe(false);
    expect(model.state().error).toBeUndefined();
  });
});

describe('library query reset', () => {
  it('drops a page that resolves after the filter changed', async () => {
    const client = createStubClient();
    const stale = deferred<ArticlePage>();
    client.list.mockReturnValueOnce(stale.promise);
    client.list.mockResolvedValue(page([article('b')], null));
    const model = createLibraryModel(client);

    const initial = model.refresh();
    await model.setFilter('unread');
    stale.resolve(page([article('a')], null));
    await initial;

    expect(model.state().filter).toBe('unread');
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);
  });

  it('resets the list when the scope changes', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a', { feedId: 'f1' })], null));
    const model = createLibraryModel(client);
    await model.refresh();

    await model.setScope({ kind: 'feeds', feedId: 'f1' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f1' },
      'all'
    );
    await model.setScope({ kind: 'feeds', feedId: 'f1' });
    expect(client.list).toHaveBeenCalledTimes(2);
  });
});
