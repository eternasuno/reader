import { removeFolder as requestRemoveFolder } from '../api/folder';
import { messageOf } from '../api/messages';
import { loadSidebar } from '../feed';
import { currentScope, selectScope } from '../library';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { showToast } from '../ui/toast';
import { openRenameFolder } from './dialog';
import { type Folder, feedIdsInFolder } from './list';

const deletedMessage = '目录已删除';
const destructiveClass = 'mt-2 border-t border-base-300 pt-2';

/** The confirmation of folders.md Messages, with its feed count or without feeds. */
export const deleteFolderQuestion = (
  folder: Folder,
  feedCount: number
): string =>
  feedCount > 0
    ? `删除目录「${folder.name}」并取消订阅其中的 ${feedCount} 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。`
    : `删除目录「${folder.name}」？`;

/** Whether the current scope is the folder itself or one of the feeds it removes. */
const scopeIsRemoved = (
  folderId: string,
  feedIds: ReadonlyArray<string>
): boolean => {
  const scope = currentScope();

  if (scope.kind === 'folder') return scope.id === folderId;

  return scope.kind === 'feed' && feedIds.includes(scope.id);
};

/**
 * Deletes the folder with its feeds and their items (FD-FOLDER-7): a scope that
 * the deletion emptied returns to `全部订阅`, any other scope stays. On failure
 * the folder, its feeds and their articles are kept.
 */
export const removeFolder = async (folder: Folder): Promise<void> => {
  const feedIds = feedIdsInFolder(folder.id);

  try {
    await requestRemoveFolder(folder.id);
  } catch (error) {
    showToast(messageOf(error), 'error');

    return;
  }

  showToast(deletedMessage);

  if (scopeIsRemoved(folder.id, feedIds)) selectScope({ kind: 'all' });

  await loadSidebar();
};

/** Asks through the browser's confirm, then deletes; cancelling changes nothing. */
export const confirmRemoveFolder = (folder: Folder): void => {
  const feedCount = feedIdsInFolder(folder.id).length;

  if (!globalThis.confirm(deleteFolderQuestion(folder, feedCount))) return;

  void removeFolder(folder);
};

/**
 * A folder scope's extra menu items, after `全部标记为已读` (folders.md): rename,
 * then the destructive delete, separated from the items above.
 */
export const FolderMenuItems = (props: {
  readonly folder: Folder;
  readonly close: () => void;
}) => (
  <>
    <li>
      <Button
        onClick={() => {
          props.close();
          openRenameFolder(props.folder);
        }}
      >
        <Icon name="folder" />
        重命名目录
      </Button>
    </li>
    <li class={destructiveClass}>
      <Button
        class="text-error"
        onClick={() => {
          props.close();
          confirmRemoveFolder(props.folder);
        }}
      >
        <Icon name="delete" />
        删除目录
      </Button>
    </li>
  </>
);
