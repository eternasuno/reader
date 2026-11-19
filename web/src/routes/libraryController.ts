import { useLocation, useNavigate } from '@solidjs/router';
import type { Accessor } from 'solid-js';
import { createEffect, createMemo, createSignal } from 'solid-js';
import type { Feed, Folder, SavedPage } from '../api';
import { t } from '../i18n';
import type { LibraryScope, RouteState } from '../state';
import {
  buildLibraryUrl,
  loadScopeFirstPage,
  moveFeedToFolder,
  openArticle,
  openArticleByRoute,
  parseLibraryLocation,
  prependSavedPageLocal,
  refreshSidebar,
  feeds as sidebarFeeds,
  folders as sidebarFolders,
} from '../state';
import { useOpmlImport } from './importOpml';

export interface FolderDialogState {
  mode: 'create' | 'rename';
  folder: Folder | null;
}

/**
 * Everything the library layout renders from. Accessors keep the layout reactive without passing
 * two dozen individual props through the panel components.
 */
export interface LibraryController {
  routeState: Accessor<RouteState | null>;
  title: Accessor<string>;
  scope: Accessor<LibraryScope>;
  articleId: Accessor<string | null>;
  unreadOnly: Accessor<boolean>;
  drawerOpen: Accessor<boolean>;
  addLinkOpen: Accessor<boolean>;
  addFeedOpen: Accessor<boolean>;
  folderDialog: Accessor<FolderDialogState | null>;
  moveFeed: Accessor<Feed | null>;
  toggleDrawer: () => void;
  dismissDrawer: () => void;
  closeDrawer: () => void;
  onNavigate: (url: string) => void;
  requestAddLink: () => void;
  requestAddFeed: () => void;
  requestNewFolder: () => void;
  requestRenameFolder: (folder: Folder) => void;
  requestMoveFeed: (feed: Feed) => void;
  requestImportOpml: () => void;
  closeAddLink: () => void;
  closeAddFeed: () => void;
  closeFolderDialog: () => void;
  closeMoveFeed: () => void;
  handleSavedPage: (page: SavedPage) => void;
  openExistingPage: (page: SavedPage) => void;
  openFeed: (feed: Feed) => void;
  handleMoveFeed: (feed: Feed, folderId: string | null) => Promise<void>;
  mobileHeader: (element: HTMLElement) => void;
  opmlInput: (element: HTMLInputElement) => void;
  handleOpmlChange: (event: Event) => void;
  refreshSidebar: () => void;
}

const scopeKey = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case 'later':
      return 'later';
    case 'all':
      return 'all';
    case 'feed':
      return `feed:${scope.feedId}`;
    case 'folder':
      return `folder:${scope.folderId}`;
  }
};

const scopeTitleOf = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case 'later':
      return String(t('library.laterScope'));
    case 'all':
      return String(t('library.allFeedsScope'));
    case 'feed':
      return (
        sidebarFeeds().find((feed) => feed.id === scope.feedId)?.title ?? ''
      );
    case 'folder':
      return (
        sidebarFolders().find((folder) => folder.id === scope.folderId)?.name ??
        ''
      );
  }
};

/** The URL is the source of truth for scope, open article, and the `?unread` filter. */
const useRouteScope = () => {
  const location = useLocation();
  const routeState = createMemo<RouteState | null>(() =>
    parseLibraryLocation(location.pathname, location.search)
  );
  const scope = createMemo<LibraryScope>(
    () => routeState()?.scope ?? { kind: 'later' }
  );
  const articleId = createMemo<string | null>(
    () => routeState()?.articleId ?? null
  );
  const unreadOnly = createMemo<boolean>(
    () => routeState()?.unreadOnly ?? false
  );

  return { routeState, scope, articleId, unreadOnly };
};

/** `LIB-VIEW-1`: the narrow-screen drawer closes on navigation and restores focus on dismiss. */
const useDrawer = () => {
  const [drawerOpen, setOpen] = createSignal(false);
  let header: HTMLElement | undefined;

  const dismissDrawer = (): void => {
    setOpen(false);
  };

  const closeDrawer = (): void => {
    dismissDrawer();
    header?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const mobileHeader = (element: HTMLElement): void => {
    header = element;
  };

  const toggleDrawer = (): void => {
    setOpen((value) => !value);
  };

  return { drawerOpen, dismissDrawer, closeDrawer, mobileHeader, toggleDrawer };
};

/** `LIB-ADD-*`, `FD-MOVE-1`: the four library dialogs and their open flags. */
const useDialogs = () => {
  const [addLinkOpen, setAddLinkOpen] = createSignal(false);
  const [addFeedOpen, setAddFeedOpen] = createSignal(false);
  const [folderDialog, setFolderDialog] =
    createSignal<FolderDialogState | null>(null);
  const [moveFeed, setMoveFeed] = createSignal<Feed | null>(null);

  const folder = (mode: 'create' | 'rename', target: Folder | null): void => {
    setFolderDialog({ mode, folder: target });
  };

  return {
    addLinkOpen,
    addFeedOpen,
    folderDialog,
    moveFeed,
    requestAddLink: () => setAddLinkOpen(true),
    requestAddFeed: () => setAddFeedOpen(true),
    requestNewFolder: () => folder('create', null),
    requestRenameFolder: (target: Folder) => folder('rename', target),
    requestMoveFeed: (feed: Feed) => setMoveFeed(feed),
    closeAddLink: () => setAddLinkOpen(false),
    closeAddFeed: () => setAddFeedOpen(false),
    closeFolderDialog: () => setFolderDialog(null),
    closeMoveFeed: () => setMoveFeed(null),
  };
};

/**
 * `LIB-RELOAD-1`: entering the library or changing scope / `?unread` reloads page 1 and the
 * sidebar summaries. `RD-ARTICLE-1`: scope or article changes drive the open reader; cached rows
 * render instantly. Neither effect re-runs for an unrelated route change.
 */
const useLibraryEffects = (routeState: () => RouteState | null): void => {
  let loadedKey: string | null = null;
  let openedKey: string | null = null;

  createEffect(
    () => routeState(),
    (state) => {
      if (state === null) return;

      const key = `${scopeKey(state.scope)}|${state.unreadOnly}`;
      if (key === loadedKey) return;
      loadedKey = key;

      queueMicrotask(() => {
        void refreshSidebar();
        void loadScopeFirstPage(state.scope, state.unreadOnly);
      });
    }
  );

  createEffect(
    () => routeState(),
    (state) => {
      if (state === null) return;

      const key = `${scopeKey(state.scope)}|${state.articleId ?? ''}`;
      if (key === openedKey) return;
      openedKey = key;

      queueMicrotask(() => {
        void openArticleByRoute(state.scope, state.articleId);
      });
    }
  );
};

/** `SP-ADD-1`, `FD-MOVE-1`: navigation that keeps the sidebar summaries in sync. */
const useArticleActions = (
  scope: Accessor<LibraryScope>,
  unreadOnly: Accessor<boolean>,
  navigate: (url: string) => void
) => {
  const openExistingPage = (page: SavedPage): void => {
    void refreshSidebar();
    navigate(buildLibraryUrl({ kind: 'later' }, { articleId: page.id }));
  };

  const openFeed = (feed: Feed): void => {
    void refreshSidebar();
    navigate(buildLibraryUrl({ kind: 'feed', feedId: feed.id }));
  };

  const handleSavedPage = (page: SavedPage): void => {
    prependSavedPageLocal(page);
    openExistingPage(page);
  };

  /** Leaving the open folder scope leaves the open article from that feed. */
  const handleMoveFeed = async (
    feed: Feed,
    targetFolderId: string | null
  ): Promise<void> => {
    const moved = await moveFeedToFolder(feed, targetFolderId);
    if (!moved) return;

    const current = scope();
    if (current.kind !== 'folder' || current.folderId === targetFolderId)
      return;

    const open = openArticle();
    if (open === null || open.kind !== 'feed' || open.feedId !== feed.id)
      return;

    navigate(buildLibraryUrl(current, { unreadOnly: unreadOnly() }));
  };

  return { openExistingPage, openFeed, handleSavedPage, handleMoveFeed };
};

export const createLibraryController = (): LibraryController => {
  const navigate = useNavigate();
  const route = useRouteScope();
  const drawer = useDrawer();
  const dialogs = useDialogs();
  const opml = useOpmlImport();
  const articles = useArticleActions(route.scope, route.unreadOnly, navigate);

  useLibraryEffects(route.routeState);

  const onNavigate = (url: string): void => {
    drawer.dismissDrawer();
    navigate(url);
  };

  return {
    ...route,
    ...drawer,
    ...dialogs,
    ...articles,
    title: () => scopeTitleOf(route.scope()),
    onNavigate,
    requestImportOpml: opml.openPicker,
    opmlInput: opml.inputRef,
    handleOpmlChange: opml.onChange,
    refreshSidebar: () => void refreshSidebar(),
  };
};
