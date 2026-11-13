import { Option } from 'effect';
import { libraryErrorMessage } from '../../api/library';
import type { LibraryStore } from './context';
import { renameFolderIn, upsertFolder } from './folders';
import { startLoad } from './loading';
import { loadReference } from './reference';

const scopeTouchesFolder = (store: LibraryStore, folderId: string): boolean => {
  const { scope, feeds } = store.state();
  if (scope.kind === 'folder') {
    return scope.folderId === folderId;
  }

  if (scope.kind !== 'feeds' || scope.feedId === undefined) {
    return false;
  }

  const feed = feeds.find((item) => item.id === scope.feedId);

  return (
    feed !== undefined && Option.getOrUndefined(feed.folderId) === folderId
  );
};

export const createFolder = async (
  store: LibraryStore,
  name: string
): Promise<boolean> => {
  try {
    const folder = await store.client.createFolder(name);
    store.setState((current) => ({
      ...current,
      folders: upsertFolder(current.folders, folder),
    }));
    store.notify('success', '目录已创建');

    return true;
  } catch (error) {
    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const renameFolder = async (
  store: LibraryStore,
  id: string,
  name: string
): Promise<boolean> => {
  try {
    await store.client.renameFolder(id, name);
    store.setState((current) => ({
      ...current,
      folders: renameFolderIn(current.folders, id, name.trim()),
    }));
    store.notify('success', '目录已重命名');

    return true;
  } catch (error) {
    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const removeFolder = async (
  store: LibraryStore,
  id: string
): Promise<boolean> => {
  try {
    await store.client.removeFolder(id);
    const touched = scopeTouchesFolder(store, id);
    if (touched) {
      await startLoad(store, { kind: 'feeds' }, store.state().unreadOnly);
    }

    await loadReference(store);
    store.notify('success', '目录已删除');

    return true;
  } catch (error) {
    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const moveFeed = async (
  store: LibraryStore,
  feedId: string,
  folderId: string | undefined
): Promise<boolean> => {
  try {
    await store.client.moveFeed(feedId, folderId);
    store.setState((current) => ({
      ...current,
      feeds: current.feeds.map((feed) =>
        feed.id === feedId
          ? { ...feed, folderId: Option.fromUndefinedOr(folderId) }
          : feed
      ),
    }));
    store.notify('success', '已移动');

    return true;
  } catch (error) {
    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};
