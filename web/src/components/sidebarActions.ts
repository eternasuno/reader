import { type Feed, type Folder, foldersApi } from '../api';
import { t } from '../i18n';
import {
  buildLibraryUrl,
  expandFolder,
  isLibraryMounted,
  isSameScope,
  type LibraryScope,
  openArticle,
  refreshSidebar,
  removeFolderLocal,
  unsubscribeFeed,
} from '../state';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { SidebarProps } from './sidebarProps';

export const isActiveScope = (
  props: SidebarProps,
  scope: LibraryScope
): boolean => isSameScope(props.scope, scope);

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

const navigateToAll = (props: SidebarProps): void => {
  props.onNavigate(
    buildLibraryUrl({ kind: 'all' }, { unreadOnly: props.unreadOnly })
  );
};

export const deleteFeed = async (
  props: SidebarProps,
  feed: Feed
): Promise<void> => {
  if (!window.confirm(String(t('feeds.unsubscribeConfirm')))) return;
  if (!(await unsubscribeFeed(feed))) return;
  // The user may have left the library while the request ran; don't navigate them back.
  if (!isLibraryMounted()) return;

  if (props.scope.kind === 'feed' && props.scope.feedId === feed.id) {
    navigateToAll(props);
    return;
  }

  const open = openArticle();
  if (open?.kind === 'feed' && open.feedId === feed.id) {
    selectScope(props, props.scope);
  }
};

/** `folders.md:19`: deleting a folder only removes it; its feeds move to the top level. */
export const deleteFolder = async (
  props: SidebarProps,
  folder: Folder
): Promise<void> => {
  const message = String(t('folders.deleteConfirm', { name: folder.name }));
  if (!window.confirm(message)) return;

  try {
    await foldersApi.remove(folder.id);
  } catch (error) {
    showToast(errorText(error), 'error');
    return;
  }

  removeFolderLocal(folder.id);
  await refreshSidebar();
  showToast(String(t('folders.deletedToast')), 'success');

  if (props.scope.kind === 'folder' && props.scope.folderId === folder.id) {
    navigateToAll(props);
  }
};
