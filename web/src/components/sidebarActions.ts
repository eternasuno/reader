import { type Feed, type Folder, foldersApi } from '../api';
import { t } from '../i18n';
import {
  activeScope,
  buildLibraryUrl,
  errorText,
  expandFolder,
  isLibraryMounted,
  type LibraryScope,
  refreshSidebar,
  removeFolderLocal,
} from '../state';
import { showToast } from '../ui';
import type { SidebarProps } from './sidebarProps';

/** `LIB-SCOPE-1`: the filter toggles the `?unread` flag of the viewed scope. */
export const toggleUnread = (props: SidebarProps): void => {
  props.onNavigate(
    buildLibraryUrl(props.scope, { unreadOnly: !props.unreadOnly })
  );
};

export const selectScope = (props: SidebarProps, scope: LibraryScope): void => {
  props.onNavigate(buildLibraryUrl(scope, { unreadOnly: props.unreadOnly }));
};

export const selectFeed = (props: SidebarProps, feed: Feed): void => {
  const folderId = feed.folderId ?? null;
  if (folderId !== null) expandFolder(folderId);

  selectScope(props, { kind: 'feed', feedId: feed.id });
};

/** `FD-FOLDER-4`: deleting a folder only removes it; its feeds move to the top level. */
export const deleteFolder = async (
  props: SidebarProps,
  folder: Folder
): Promise<void> => {
  const message = t('folders.deleteConfirm', { name: folder.name });
  if (!window.confirm(message)) return;

  try {
    await foldersApi.remove(folder.id);
  } catch (error) {
    showToast(errorText(error), 'error');

    return;
  }

  removeFolderLocal(folder.id);
  await refreshSidebar();
  showToast(t('folders.deletedToast'), 'success');
  if (!isLibraryMounted()) return;

  const scope = activeScope();
  if (scope.kind === 'folder' && scope.folderId === folder.id) {
    props.onNavigate(
      buildLibraryUrl({ kind: 'all' }, { unreadOnly: props.unreadOnly })
    );
  }
};
