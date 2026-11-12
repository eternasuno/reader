// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped model cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { LibraryError } from '../../src/lib/library';
import { createLibraryModel } from '../../src/pages/library-model';
import {
  counts,
  createStubClient,
  deferred,
  feed,
  folder,
} from './library-fixtures';

const writeModel = async (
  folders = [folder('fo1', 'Tech')],
  feeds = [feed('f1', 'https://example.com/f1.xml', 'fo1'), feed('f2')]
) => {
  const client = createStubClient();
  client.folders.mockResolvedValue(folders);
  client.feeds.mockResolvedValue(feeds);
  client.unreadCounts.mockResolvedValue(counts(0, { f1: 3, f2: 5 }));
  const model = createLibraryModel(client);
  await model.refresh();

  return { client, model };
};

const reloadCounts = (client: ReturnType<typeof createStubClient>) => ({
  folders: client.folders.mock.calls.length,
  feeds: client.feeds.mock.calls.length,
  counts: client.unreadCounts.mock.calls.length,
  list: client.list.mock.calls.length,
});

describe('library folder creation', () => {
  it('inserts a created folder in name order and keeps the scope', async () => {
    const { client, model } = await writeModel();
    client.createFolder.mockResolvedValue(folder('fo2', 'Design'));
    const before = reloadCounts(client);

    expect(await model.createFolder('Design')).toBe(true);

    expect(client.createFolder).toHaveBeenCalledWith('Design');
    expect(model.state().folders.map((item) => item.name)).toEqual([
      'Design',
      'Tech',
    ]);
    expect(model.state().scope).toEqual({ kind: 'later' });
    expect(reloadCounts(client).list).toBe(before.list);
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '目录已创建',
    });
  });

  it('reports a create failure and keeps the folders unchanged', async () => {
    const { client, model } = await writeModel();
    client.createFolder.mockRejectedValue(
      new LibraryError('FolderAlreadyExists')
    );

    expect(await model.createFolder('Tech')).toBe(false);

    expect(model.state().folders.map((item) => item.name)).toEqual(['Tech']);
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '该目录名称已存在',
    });
  });
});

describe('library folder rename', () => {
  it('renames, trims and re-sorts without reloading the list', async () => {
    const { client, model } = await writeModel([
      folder('fo1', 'Tech'),
      folder('fo2', 'Design'),
    ]);
    const before = reloadCounts(client);

    expect(await model.renameFolder('fo1', '  Archive  ')).toBe(true);

    expect(client.renameFolder).toHaveBeenCalledWith('fo1', '  Archive  ');
    expect(model.state().folders.map((item) => item.name)).toEqual([
      'Archive',
      'Design',
    ]);
    expect(reloadCounts(client).list).toBe(before.list);
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '目录已重命名',
    });
  });

  it('keeps the old name and reports a rename failure', async () => {
    const { client, model } = await writeModel();
    client.renameFolder.mockRejectedValue(
      new LibraryError('FolderAlreadyExists')
    );

    expect(await model.renameFolder('fo1', 'News')).toBe(false);

    expect(model.state().folders.map((item) => item.name)).toEqual(['Tech']);
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '该目录名称已存在',
    });
  });
});

describe('library folder removal', () => {
  it('returns to all feeds when the selected folder is removed', async () => {
    const { client, model } = await writeModel();
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    client.folders.mockResolvedValue([]);
    client.feeds.mockResolvedValue([feed('f2')]);
    const before = reloadCounts(client);

    expect(await model.removeFolder('fo1')).toBe(true);

    expect(model.state().scope).toEqual({ kind: 'feeds' });
    expect(client.list).toHaveBeenLastCalledWith({ kind: 'feeds' }, false);
    expect(reloadCounts(client)).toEqual({
      folders: before.folders + 1,
      feeds: before.feeds + 1,
      counts: before.counts + 1,
      list: before.list + 1,
    });
    expect(model.state().folders).toEqual([]);
    expect(model.state().toast).toEqual({
      kind: 'success',
      message: '目录已删除',
    });
  });

  it('returns to all feeds when a feed of the removed folder is selected', async () => {
    const { client, model } = await writeModel();
    await model.setScope({ kind: 'feeds', feedId: 'f1' });

    await model.removeFolder('fo1');

    expect(model.state().scope).toEqual({ kind: 'feeds' });
    expect(client.list).toHaveBeenLastCalledWith({ kind: 'feeds' }, false);
  });

  it('leaves an unrelated scope alone while reloading the sidebar', async () => {
    const { client, model } = await writeModel();
    await model.setScope({ kind: 'feeds', feedId: 'f2' });
    const before = reloadCounts(client);

    expect(await model.removeFolder('fo1')).toBe(true);

    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f2' });
    expect(reloadCounts(client)).toEqual({
      folders: before.folders + 1,
      feeds: before.feeds + 1,
      counts: before.counts + 1,
      list: before.list,
    });
  });

  it('keeps the scope chosen while a folder removal is pending', async () => {
    const { client, model } = await writeModel();
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    const remove = deferred<void>();
    client.removeFolder.mockReturnValue(remove.promise);

    const pending = model.removeFolder('fo1');
    await model.setScope({ kind: 'feeds', feedId: 'f2' });
    client.folders.mockResolvedValue([]);
    client.feeds.mockResolvedValue([feed('f2')]);
    remove.resolve();

    expect(await pending).toBe(true);
    expect(model.state().scope).toEqual({ kind: 'feeds', feedId: 'f2' });
    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f2' },
      false
    );
  });

  it('returns to all feeds when the folder is selected while its removal is pending', async () => {
    const { client, model } = await writeModel();
    const remove = deferred<void>();
    client.removeFolder.mockReturnValue(remove.promise);

    const pending = model.removeFolder('fo1');
    await model.setScope({ kind: 'folder', folderId: 'fo1' });
    client.folders.mockResolvedValue([]);
    client.feeds.mockResolvedValue([feed('f2')]);
    remove.resolve();

    expect(await pending).toBe(true);
    expect(model.state().scope).toEqual({ kind: 'feeds' });
    expect(client.list).toHaveBeenLastCalledWith({ kind: 'feeds' }, false);
  });

  it('keeps the folder and its feeds when removal fails', async () => {
    const { client, model } = await writeModel();
    const before = reloadCounts(client);
    client.removeFolder.mockRejectedValue(
      new LibraryError('FolderRepositoryError')
    );

    expect(await model.removeFolder('fo1')).toBe(false);

    expect(model.state().folders.map((item) => item.name)).toEqual(['Tech']);
    expect(model.state().feeds.map((item) => item.id)).toEqual(['f1', 'f2']);
    expect(reloadCounts(client)).toEqual(before);
    expect(model.state().toast).toEqual({
      kind: 'error',
      message: '暂时无法访问目录，请稍后重试',
    });
  });
});
