// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { LibraryError } from '../../../../src/api/library';
import { unreadCount } from '../../../../src/models/library/counts';
import { feedsInFolder } from '../../../../src/models/library/folders';
import { createLibraryModel } from '../../../../src/models/library/model';
import {
  article,
  counts,
  createStubClient,
  deferred,
  feed,
  folder,
  page,
} from '../../../support/library';

const folderModel = async () => {
  const client = createStubClient();
  client.folders.mockResolvedValue([
    folder('fo1', 'Tech'),
    folder('fo2', 'News'),
  ]);
  client.feeds.mockResolvedValue([
    feed('f1', 'https://example.com/f1.xml', 'fo1'),
    feed('f2', 'https://example.com/f2.xml', 'fo1'),
    feed('f3'),
  ]);
  client.unreadCounts.mockResolvedValue(counts(0, { f1: 3, f2: 2, f3: 5 }));
  const model = createLibraryModel(client);
  await model.refresh();

  return { client, model };
};

describe('library folder scope', () => {
  it('lists the folder page and sums the unread counts of its feeds', async () => {
    const { client, model } = await folderModel();
    client.list.mockResolvedValue(
      page([article('a', { feedId: 'f1' })], 'cursor-1')
    );

    await model.setScope({ kind: 'folder', folderId: 'fo1' });

    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'folder', folderId: 'fo1' },
      false
    );
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);
    expect(model.state().folders.map((item) => item.id)).toEqual([
      'fo1',
      'fo2',
    ]);
    expect(
      unreadCount(
        model.state().counts,
        model.state().scope,
        model.state().feeds
      )
    ).toBe(5);
  });

  it('marks the folder read in one request and clears only its counts', async () => {
    const { client, model } = await folderModel();
    client.list.mockResolvedValue(page([article('a', { feedId: 'f1' })]));
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    const mark = deferred<void>();
    client.markFolders.mockReturnValue(mark.promise);

    const pending = model.markAll();

    expect(client.markFolders).toHaveBeenCalledWith(['fo1']);
    expect(client.markFeeds).not.toHaveBeenCalled();
    expect(client.markAllFeeds).not.toHaveBeenCalled();
    expect(model.state().counts).toEqual({
      later: 0,
      feeds: { f1: 0, f2: 0, f3: 5 },
      feedsTotal: 5,
    });

    mark.resolve();
    await pending;

    expect(model.state().items.every((item) => item.read)).toBe(true);
    expect(model.state().pending.size).toBe(0);
  });

  it('leaves articles of a feed moved out of the folder unread when marking all', async () => {
    const { client, model } = await folderModel();
    client.list.mockResolvedValue(
      page([article('a', { feedId: 'f1' }), article('b', { feedId: 'f2' })])
    );
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    await model.moveFeed('f1', 'fo2');

    await model.markAll();

    expect(client.markFolders).toHaveBeenCalledWith(['fo1']);
    expect(model.state().items.find((item) => item.id === 'a')?.read).toBe(
      false
    );
    expect(model.state().items.find((item) => item.id === 'b')?.read).toBe(
      true
    );
    expect(model.state().pending.size).toBe(0);
  });

  it('rolls back a failed folder mark-all', async () => {
    const { client, model } = await folderModel();
    client.list.mockResolvedValue(page([article('a', { feedId: 'f1' })]));
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    const mark = deferred<void>();
    client.markFolders.mockReturnValue(mark.promise);

    const pending = model.markAll();
    mark.reject(new LibraryError('FeedItemRepositoryError'));
    await pending;

    expect(model.state().counts).toEqual(counts(0, { f1: 3, f2: 2, f3: 5 }));
    expect(model.state().items.every((item) => item.read)).toBe(false);
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问订阅文章，请稍后重试',
    });
  });
});

describe('library folder subscription', () => {
  it('subscribes into a folder and selects the new feed', async () => {
    const { client, model } = await folderModel();
    client.subscribe.mockResolvedValue(
      feed('f9', 'https://example.com/f9.xml', 'fo2')
    );

    expect(
      await model.subscribe('https://example.com/f9.xml', 'Feed f9', 'fo2')
    ).toBe(true);

    expect(client.subscribe).toHaveBeenCalledWith(
      'https://example.com/f9.xml',
      'Feed f9',
      'fo2'
    );
    expect(
      model.state().feeds.find((item) => item.id === 'f9')?.folderId
    ).toEqual(Option.some('fo2'));
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f9' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f9' },
      false
    );
  });

  it('subscribes at the top level without a folder', async () => {
    const { client, model } = await folderModel();
    client.subscribe.mockResolvedValue(feed('f9'));

    await model.subscribe('https://example.com/f9.xml', 'Feed f9');

    expect(client.subscribe).toHaveBeenCalledWith(
      'https://example.com/f9.xml',
      'Feed f9'
    );
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f9' });
    expect(
      model.state().feeds.find((item) => item.id === 'f9')?.folderId
    ).toEqual(Option.none());
  });
});

describe('library feed move', () => {
  it('updates the feed folder without reloading the list', async () => {
    const { client, model } = await folderModel();
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    const calls = client.list.mock.calls.length;

    expect(await model.moveFeed('f1', 'fo2')).toBe(true);

    expect(client.moveFeed).toHaveBeenCalledWith('f1', 'fo2');
    expect(
      model.state().feeds.find((item) => item.id === 'f1')?.folderId
    ).toEqual(Option.some('fo2'));
    expect(
      feedsInFolder(model.state().feeds, 'fo1').map((item) => item.id)
    ).toEqual(['f2']);
    expect(client.list).toHaveBeenCalledTimes(calls);
    expect(model.state().scope).toEqual({ kind: 'folder', folderId: 'fo1' });
    expect(model.state().toast).toEqual({ kind: 'success', message: '已移动' });
  });

  it('moves a feed out of its folder and reports a failure', async () => {
    const { client, model } = await folderModel();
    const move = deferred<void>();
    client.moveFeed.mockReturnValue(move.promise);

    const pending = model.moveFeed('f1', undefined);

    expect(
      model.state().feeds.find((item) => item.id === 'f1')?.folderId
    ).toEqual(Option.some('fo1'));

    move.reject(new LibraryError('FeedRepositoryError'));
    expect(await pending).toBe(false);

    expect(
      model.state().feeds.find((item) => item.id === 'f1')?.folderId
    ).toEqual(Option.some('fo1'));
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问订阅，请稍后重试',
    });

    client.moveFeed.mockResolvedValue(undefined);
    expect(await model.moveFeed('f1', undefined)).toBe(true);
    expect(
      model.state().feeds.find((item) => item.id === 'f1')?.folderId
    ).toEqual(Option.none());
  });
});
