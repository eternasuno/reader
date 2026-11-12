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

    expect(client.list).toHaveBeenCalledWith({ kind: 'later' }, false);
    expect(model.state()).toMatchObject({
      initialized: true,
      loading: false,
      cursor: 'cursor-1',
    });
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);
    expect(model.state().feeds).toEqual([feed('f1')]);
    expect(model.state().counts).toEqual(counts(1, { f1: 0 }));
    expect(client.unreadCounts).toHaveBeenCalledTimes(1);
    expect(model.state().error).toBeUndefined();
  });

  it('keeps loaded data when feeds or counts fail', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')]));
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

  it('keeps the last counts when the count request fails', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')]));
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
    client.list.mockResolvedValue(page([article('a')]));
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
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'later' },
      false,
      'cursor-1'
    );
  });

  it('stops paging once the last page is loaded', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], null));
    const model = createLibraryModel(client);
    await model.refresh();

    await model.loadMore();

    expect(client.list).toHaveBeenCalledTimes(1);
  });
});

describe('library query reset', () => {
  it('drops a page that resolves after the filter changed', async () => {
    const client = createStubClient();
    const stale = deferred<ArticlePage>();
    client.list.mockReturnValueOnce(stale.promise);
    client.list.mockResolvedValue(page([article('b')]));
    const model = createLibraryModel(client);

    const initial = model.refresh();
    await model.setFilter(true);
    stale.resolve(page([article('a')]));
    await initial;

    expect(model.state().unreadOnly).toBe(true);
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);
  });

  it('reloads the first page when the filter changes', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')], 'cursor-1'));
    const model = createLibraryModel(client);
    await model.refresh();

    client.list.mockResolvedValue(page([article('u')], 'cursor-2'));
    await model.setFilter(true);

    expect(client.list).toHaveBeenLastCalledWith({ kind: 'later' }, true);
    expect(model.state().unreadOnly).toBe(true);
    expect(model.state().items.map((item) => item.id)).toEqual(['u']);
    expect(model.state().cursor).toBe('cursor-2');
  });

  it('keeps the filter and does not reload when it is unchanged', async () => {
    const client = createStubClient();
    const model = createLibraryModel(client);
    await model.refresh();

    await model.setFilter(false);

    expect(client.list).toHaveBeenCalledTimes(1);
  });

  it('resets the list when the scope changes', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a', { feedId: 'f1' })]));
    const model = createLibraryModel(client);
    await model.refresh();

    await model.setScope({ kind: 'feeds', feedId: 'f1' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f1' },
      false
    );
    await model.setScope({ kind: 'feeds', feedId: 'f1' });
    expect(client.list).toHaveBeenCalledTimes(2);
  });
});
