// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped folder cases stay together with their shared fixtures.
import { describe, expect, it, vi } from 'vitest';
import type { Feed, Scope } from '../../src/lib/library';
import { clearScopeCounts, unreadCount } from '../../src/pages/library-counts';
import { confirmRemoveFolder } from '../../src/pages/library-feed-menu';
import {
  feedsInFolder,
  folderUnread,
  groupFeeds,
  renameFolderIn,
  upsertFolder,
} from '../../src/pages/library-folders';
import { createLibraryModel } from '../../src/pages/library-model';
import { sameScope } from '../../src/pages/library-state';
import { counts, createStubClient, feed, folder } from './library-fixtures';

describe('library folder list helpers', () => {
  it('inserts folders by name then id', () => {
    const folders = [folder('a', 'Tech'), folder('b', 'News')];

    expect(
      upsertFolder(folders, folder('c', 'News')).map((item) => item.id)
    ).toEqual(['b', 'c', 'a']);
    expect(
      upsertFolder(folders, { ...folder('a', 'Tech'), name: 'Alpha' }).map(
        (item) => item.id
      )
    ).toEqual(['a', 'b']);
  });

  it('renames and re-sorts an existing folder', () => {
    const folders = [folder('a', 'Tech'), folder('b', 'News')];

    expect(
      renameFolderIn(folders, 'a', 'Archive').map((item) => item.name)
    ).toEqual(['Archive', 'News']);
    expect(
      renameFolderIn(folders, 'missing', 'Archive').map((item) => item.name)
    ).toEqual(['News', 'Tech']);
  });

  it('selects the folder feeds and sums their unread counts', () => {
    const feeds = [
      feed('f1', 'https://example.com/f1.xml', 'fo1'),
      feed('f2', 'https://example.com/f2.xml', 'fo1'),
      feed('f3'),
    ];

    expect(feedsInFolder(feeds, 'fo1').map((item) => item.id)).toEqual([
      'f1',
      'f2',
    ]);
    expect(folderUnread(counts(0, { f1: 3 }), feeds, 'fo1')).toBe(3);
    expect(folderUnread(counts(0, { f1: 3, f3: 5 }), feeds, 'empty')).toBe(0);
  });

  it('groups feeds under folders and keeps unknown folders at the top', () => {
    const folders = [folder('fo2', 'News'), folder('fo1', 'Tech')];
    const feeds = [
      feed('f1', 'https://example.com/f1.xml', 'fo1'),
      feed('f2', 'https://example.com/f2.xml', 'fo2'),
      feed('f3', 'https://example.com/f3.xml', 'gone'),
      feed('f4'),
    ];
    const grouped = groupFeeds(folders, feeds);
    const groupedFeeds = grouped.groups.map((group) =>
      group.feeds.map((item) => item.id)
    );

    expect(grouped.groups.map((group) => group.folder.id)).toEqual([
      'fo2',
      'fo1',
    ]);
    expect(groupedFeeds).toEqual([['f2'], ['f1']]);
    expect(grouped.topLevel.map((item) => item.id)).toEqual(['f3', 'f4']);
  });

  it('compares folder scopes', () => {
    const tech: Scope = { kind: 'folder', folderId: 'fo1' };

    expect(sameScope(tech, { kind: 'folder', folderId: 'fo1' })).toBe(true);
    expect(sameScope(tech, { kind: 'folder', folderId: 'fo2' })).toBe(false);
    expect(sameScope(tech, { kind: 'feeds' })).toBe(false);
    expect(sameScope({ kind: 'feeds' }, tech)).toBe(false);
  });
});

describe('library folder scope counts', () => {
  const feeds = [
    feed('f1', 'https://example.com/f1.xml', 'fo1'),
    feed('f2', 'https://example.com/f2.xml', 'fo1'),
    feed('f3'),
  ];
  const tech: Scope = { kind: 'folder', folderId: 'fo1' };
  const before = counts(4, { f1: 3, f2: 2, f3: 5 });

  it('reads a folder as the sum of its feeds', () => {
    expect(unreadCount(before, tech, feeds)).toBe(5);
    expect(
      unreadCount(before, { kind: 'folder', folderId: 'none' }, feeds)
    ).toBe(0);
  });

  it('clears a folder without touching other feeds', () => {
    const cleared = clearScopeCounts(before, tech, feeds);

    expect(cleared).toEqual({
      later: 4,
      feeds: { f1: 0, f2: 0, f3: 5 },
      feedsTotal: 5,
    });
    expect(clearScopeCounts(counts(0, { f3: 5 }), tech, feeds)).toEqual({
      later: 0,
      feeds: { f1: 0, f2: 0, f3: 5 },
      feedsTotal: 5,
    });
  });
});

describe('library folder removal confirmation', () => {
  const setup = async (loaded: ReadonlyArray<Feed>) => {
    const client = createStubClient();
    client.feeds.mockResolvedValue(loaded);
    const model = createLibraryModel(client);
    await model.refresh();

    return { client, model };
  };

  const stubConfirm = (answer: boolean) => {
    const confirm = vi.fn(() => answer);
    vi.stubGlobal('window', { confirm });

    return confirm;
  };

  it('names the feeds that will be unsubscribed', async () => {
    const { client, model } = await setup([
      feed('f1', 'https://example.com/f1.xml', 'fo1'),
      feed('f2', 'https://example.com/f2.xml', 'fo1'),
      feed('f3'),
    ]);
    const confirm = stubConfirm(true);

    confirmRemoveFolder(model, folder('fo1', 'Tech'));

    expect(confirm).toHaveBeenCalledWith(
      '删除目录「Tech」并取消订阅其中的 2 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。'
    );
    expect(client.removeFolder).toHaveBeenCalledWith('fo1');

    vi.unstubAllGlobals();
  });

  it('asks a plain question for an empty folder and keeps it when cancelled', async () => {
    const { client, model } = await setup([feed('f3')]);
    const confirm = stubConfirm(false);

    confirmRemoveFolder(model, folder('empty', 'Empty'));

    expect(confirm).toHaveBeenCalledWith('删除目录「Empty」？');
    expect(client.removeFolder).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
