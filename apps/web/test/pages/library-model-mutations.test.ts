// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { LibraryError } from '../../src/lib/library';
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

describe('library read marks', () => {
  it('marks a row read optimistically and rolls back on failure', async () => {
    const { client, model } = await withRows();
    const mark = deferred<void>();
    client.markRead.mockReturnValue(mark.promise);

    const pending = model.toggleRead(model.state().items[0] ?? article('a'));
    expect(model.state().items[0]?.read).toBe(true);
    // biome-ignore lint/complexity/useLiteralKeys: the counts map is an index signature.
    expect(model.state().counts.feeds['f1']).toBe(0);
    expect(model.state().pending.has('a')).toBe(true);

    mark.reject(new LibraryError('ArticleRepositoryError'));
    await pending;

    expect(model.state().items[0]?.read).toBe(false);
    // biome-ignore lint/complexity/useLiteralKeys: the counts map is an index signature.
    expect(model.state().counts.feeds['f1']).toBe(1);
    expect(model.state().pending.has('a')).toBe(false);
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问文章，请稍后重试',
    });
  });

  it('keeps a manual unread mark until the article is reopened', async () => {
    const { client, model } = await withRows([article('a')]);
    const row = model.state().items[0] ?? article('a');

    await model.toggleRead(row);
    expect(model.state().items[0]?.read).toBe(true);
    await model.toggleRead(model.state().items[0] ?? row);
    expect(model.state().items[0]?.read).toBe(false);
    client.refresh.mockResolvedValue([newerArticle('n'), article('a')]);
    await model.refresh();

    expect(model.state().items.map((item) => [item.id, item.read])).toEqual([
      ['n', false],
      ['a', false],
    ]);
  });

  it('marks the loaded rows through the article endpoint', async () => {
    const { client, model } = await withRows();

    await model.markLoaded();

    expect(client.markArticles).toHaveBeenCalledWith(['a', 'b']);
    expect(model.state().items.every((item) => item.read)).toBe(true);
    expect(model.state().pending.size).toBe(0);
  });

  it('keeps pending state until every concurrent mark settles', async () => {
    const { client, model } = await withRows([article('a')]);
    const first = deferred<void>();
    const second = deferred<void>();
    client.markRead
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const row = model.state().items[0] ?? article('a');

    const one = model.toggleRead(row);
    const two = model.toggleRead(model.state().items[0] ?? row);
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    first.resolve();
    await one;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    second.resolve();
    await two;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(false);
  });

  it('does not let a stale completion override the latest mark', async () => {
    const { client, model } = await withRows([article('a')]);
    const first = deferred<void>();
    const second = deferred<void>();
    client.markRead
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const row = model.state().items[0] ?? article('a');

    const one = model.toggleRead(row);
    const two = model.toggleRead(model.state().items[0] ?? row);

    second.resolve();
    await two;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(true);

    first.resolve();
    await one;
    expect(model.state().items[0]?.read).toBe(false);
    expect(model.state().pending.has('a')).toBe(false);
  });

  it('keeps an optimistic read mark through a pending refresh', async () => {
    const { client, model } = await withRows([article('a', { feedId: 'f1' })]);
    const mark = deferred<void>();
    client.markRead.mockReturnValue(mark.promise);
    const row = model.state().items[0] ?? article('a');

    const pending = model.toggleRead(row);
    client.refresh.mockResolvedValue([
      newerArticle('n'),
      { ...article('a', { feedId: 'f1' }), title: 'Server a' },
    ]);
    await model.refresh();

    const optimistic = model.state().items.find((item) => item.id === 'a');
    expect(optimistic).toMatchObject({ title: 'Article a', read: true });
    expect(model.state().items.map((item) => item.id)).toEqual(['n', 'a']);

    mark.resolve();
    await pending;
    expect(model.state().items.find((item) => item.id === 'a')?.read).toBe(
      true
    );
    expect(model.state().pending.has('a')).toBe(false);
  });
});

describe('library mark all', () => {
  it('snapshots the subscribed feeds and rolls back on failure', async () => {
    const { client, model } = await withRows();
    client.feeds.mockResolvedValue([feed('f1'), feed('f2')]);
    await model.setScope({ kind: 'feeds' });
    const mark = deferred<void>();
    client.markFeeds.mockReturnValue(mark.promise);

    const pending = model.markAll();
    expect(client.markFeeds).toHaveBeenCalledWith(['f1', 'f2']);
    expect(model.state().counts).toEqual(counts(0));
    expect(model.state().items.every((item) => item.read)).toBe(true);

    mark.reject(new LibraryError('ArticleRepositoryError'));
    await pending;

    expect(model.state().counts).toEqual(counts(0, { f1: 1 }));
    expect(model.state().items.every((item) => item.read)).toBe(false);
  });

  it('marks later articles through the later endpoint', async () => {
    const { client, model } = await withRows();

    await model.markAll();

    expect(client.markLater).toHaveBeenCalled();
    expect(client.markArticles).not.toHaveBeenCalled();
  });
});

describe('library add and save', () => {
  it('opens the existing article reported as a duplicate', async () => {
    const client = createStubClient();
    client.add.mockRejectedValue(
      new LibraryError('DuplicateArticle', { id: 'dup' })
    );
    client.article.mockResolvedValue(article('dup'));
    const model = createLibraryModel(client);

    expect(await model.add('https://example.com/post')).toBe(true);
    expect(client.article).toHaveBeenCalledWith('dup');
    expect(model.state().selected?.id).toBe('dup');
  });

  it('saves an article into the later list', async () => {
    const client = createStubClient();
    client.save.mockResolvedValue(article('saved'));
    const model = createLibraryModel(client);
    await model.refresh();

    expect(await model.save(article('source'))).toBe(true);
    expect(model.state().items.map((item) => item.id)).toEqual(['saved']);
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '已保存到稍后阅读',
    });
  });

  it('removes a row optimistically and restores it on failure', async () => {
    const { client, model } = await withRows();
    const remove = deferred<void>();
    client.remove.mockReturnValue(remove.promise);

    const pending = model.remove(model.state().items[0] ?? article('a'));
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);
    expect(model.state().pending.has('a')).toBe(true);

    remove.reject(new LibraryError('ArticleNotLater'));
    await pending;

    expect(model.state().items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(model.state().pending.has('a')).toBe(false);
  });

  it('selects an added article even when the active scope is a feed', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(
      page([article('feed-row', { feedId: 'f1' })], null, 'top')
    );
    client.add.mockResolvedValue(article('added'));
    const model = createLibraryModel(client);
    await model.setScope({ kind: 'feeds', feedId: 'f1' });

    expect(await model.add('https://example.com/post')).toBe(true);

    expect(model.state().selected?.id).toBe('added');
    expect(model.state().items.map((item) => item.id)).toEqual(['feed-row']);
  });

  it('opens the existing article when save reports a duplicate', async () => {
    const client = createStubClient();
    client.save.mockRejectedValue(
      new LibraryError('DuplicateArticle', { id: 'existing' })
    );
    client.article.mockResolvedValue(article('existing', { read: true }));
    const model = createLibraryModel(client);
    await model.refresh();

    expect(await model.save(article('source'))).toBe(true);

    expect(client.article).toHaveBeenCalledWith('existing');
    expect(model.state().selected?.id).toBe('existing');
  });
});

describe('library delete selection', () => {
  const opened = async () => {
    const setup = await withRows();
    setup.client.article.mockResolvedValue(article('a', { read: true }));
    await setup.model.openArticle('a');

    return setup;
  };

  it('keeps the selected article while its deletion is pending', async () => {
    const { client, model } = await opened();
    const remove = deferred<void>();
    client.remove.mockReturnValue(remove.promise);

    const pending = model.remove(article('a'));
    expect(model.state().selected?.id).toBe('a');
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);

    remove.resolve();
    await pending;

    expect(model.state().selected).toBeUndefined();
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);
  });

  it('preserves the selected article when deletion fails', async () => {
    const { client, model } = await opened();
    const remove = deferred<void>();
    client.remove.mockReturnValue(remove.promise);

    const pending = model.remove(article('a'));
    remove.reject(new LibraryError('ArticleNotLater'));
    await pending;

    expect(model.state().selected?.id).toBe('a');
    expect(model.state().items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('does not re-add a row whose deletion is still pending', async () => {
    const { client, model } = await withRows();
    const remove = deferred<void>();
    client.remove.mockReturnValue(remove.promise);

    const pending = model.remove(article('a'));
    client.refresh.mockResolvedValue([
      newerArticle('n'),
      article('a', { feedId: 'f1' }),
      article('b'),
    ]);
    await model.refresh();

    expect(model.state().items.map((item) => item.id)).toEqual(['n', 'b']);

    remove.resolve();
    await pending;

    expect(model.state().items.map((item) => item.id)).toEqual(['n', 'b']);
  });
});
