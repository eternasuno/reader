import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import {
  AddLinkDialog,
  ArticleListPane,
  FeedOptionsDialog,
  FolderNameDialog,
  KeyboardShortcutsDialog,
  ReaderPane,
  Sidebar,
  SubscribeFeedDialog,
} from '../components';
import { deleteFeed } from '../components/articleListActions';
import { t } from '../i18n';
import {
  readerFullscreen,
  sidebarCollapsed,
  feeds as sidebarFeeds,
  folders as sidebarFolders,
} from '../state';
import type { LibraryController } from './libraryController';

export type PanelName = 'sidebar' | 'list' | 'reader';

export interface LibraryViewProps {
  ctl: LibraryController;
  panelRef: (panel: PanelName, element: HTMLDivElement) => void;
}

const GRID_CLASSES =
  'grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[14rem_21rem_minmax(0,1fr)] xl:grid-cols-[16rem_24rem_minmax(0,1fr)]';

const COLLAPSED_GRID_CLASSES =
  'grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]';

const FULLSCREEN_GRID_CLASSES =
  'grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]';

const isFullscreen = (props: LibraryViewProps): boolean =>
  readerFullscreen() && props.ctl.articleId() !== null;

const gridClasses = (props: LibraryViewProps): string => {
  if (isFullscreen(props)) return FULLSCREEN_GRID_CLASSES;

  return sidebarCollapsed() ? COLLAPSED_GRID_CLASSES : GRID_CLASSES;
};

const sidebarVisibility = (drawerOpen: boolean): string => {
  if (drawerOpen) return DRAWER_CLASSES;

  return sidebarCollapsed() ? 'hidden' : 'hidden md:flex';
};

const DRAWER_CLASSES =
  'fixed inset-y-0 left-0 z-40 flex w-66 max-w-[85vw] bg-base-100 max-md:overflow-hidden max-md:rounded-r-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl md:relative md:inset-auto md:z-auto md:w-auto md:max-w-none md:pt-0 md:pb-0 md:shadow-none';

interface PanelFrameProps {
  name: PanelName;
  visible: string;
  panelRef: (element: HTMLDivElement) => void;
  children: JSX.Element;
}

/** `LIB-VIEW-1`: the panel wrapper CSS hides; `data-panel` lets focus recovery find it again. */
function PanelFrame(props: PanelFrameProps): JSX.Element {
  return (
    <div
      ref={props.panelRef}
      data-panel={props.name}
      tabindex={-1}
      class={[
        'min-h-0 min-w-0 overflow-hidden outline-none *:min-w-0 *:flex-1',
        props.visible,
      ]}
    >
      {props.children}
    </div>
  );
}

function SidebarPanel(props: LibraryViewProps): JSX.Element {
  return (
    <PanelFrame
      name="sidebar"
      panelRef={(element) => props.panelRef('sidebar', element)}
      visible={
        isFullscreen(props)
          ? 'hidden'
          : sidebarVisibility(props.ctl.drawerOpen())
      }
    >
      <Sidebar
        scope={props.ctl.scope()}
        unreadOnly={props.ctl.unreadOnly()}
        onNavigate={props.ctl.onNavigate}
        onRequestAddFeed={props.ctl.requestAddFeed}
        onRequestNewFolder={props.ctl.requestNewFolder}
        onRequestRenameFolder={props.ctl.requestRenameFolder}
        onMoveFeed={props.ctl.handleMoveFeed}
        onRequestFeedOptions={props.ctl.requestFeedOptions}
        onRequestImportOpml={props.ctl.requestImportOpml}
        onRequestAddLink={props.ctl.requestAddLink}
      />
    </PanelFrame>
  );
}

function SidebarColumn(props: LibraryViewProps): JSX.Element {
  return (
    <>
      <Show when={!isFullscreen(props) && props.ctl.drawerOpen()}>
        <button
          type="button"
          class="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-label={String(t('common.close'))}
          onClick={props.ctl.closeDrawer}
        />
      </Show>
      <SidebarPanel ctl={props.ctl} panelRef={props.panelRef} />
    </>
  );
}

function ListPanel(props: LibraryViewProps): JSX.Element {
  const visible = (): string => {
    if (isFullscreen(props)) return 'hidden';

    return props.ctl.articleId() === null ? 'flex' : 'hidden lg:flex';
  };

  return (
    <PanelFrame
      name="list"
      panelRef={(element) => props.panelRef('list', element)}
      visible={visible()}
    >
      <ArticleListPane
        scope={props.ctl.scope()}
        openArticleId={props.ctl.articleId()}
        unreadOnly={props.ctl.unreadOnly()}
        drawerOpen={props.ctl.drawerOpen()}
        onToggleNav={props.ctl.toggleDrawer}
        navToggleRef={props.ctl.navToggle}
        onNavigate={props.ctl.onNavigate}
        onRequestAddLink={props.ctl.requestAddLink}
        onRequestAddFeed={props.ctl.requestAddFeed}
        onMoveFeed={props.ctl.handleMoveFeed}
        onRequestNewFolder={props.ctl.requestNewFolder}
        onRequestFeedOptions={props.ctl.requestFeedOptions}
      />
    </PanelFrame>
  );
}

function ReaderPanel(props: LibraryViewProps): JSX.Element {
  const visible = (): string =>
    props.ctl.articleId() !== null ? 'flex' : 'hidden lg:flex';

  return (
    <PanelFrame
      name="reader"
      panelRef={(element) => props.panelRef('reader', element)}
      visible={visible()}
    >
      <ReaderPane
        scope={props.ctl.scope()}
        unreadOnly={props.ctl.unreadOnly()}
        onNavigate={props.ctl.onNavigate}
        onRequestFeedOptions={props.ctl.requestFeedOptions}
      />
    </PanelFrame>
  );
}

function AddDialogs(props: LibraryViewProps): JSX.Element {
  return (
    <>
      <AddLinkDialog
        open={props.ctl.addLinkOpen()}
        onClose={props.ctl.closeAddLink}
        onSaved={props.ctl.handleSavedPage}
        onDuplicateFound={props.ctl.openExistingPage}
      />
      <SubscribeFeedDialog
        open={props.ctl.addFeedOpen()}
        folders={sidebarFolders()}
        existingFeeds={sidebarFeeds()}
        onClose={props.ctl.closeAddFeed}
        onSubscribed={props.ctl.openSubscribedFeed}
        onDuplicateFound={props.ctl.openFeed}
      />
    </>
  );
}

function ManageDialogs(props: LibraryViewProps): JSX.Element {
  return (
    <>
      <Show when={props.ctl.folderDialog()} keyed>
        {(dialog) => (
          <FolderNameDialog
            open={true}
            mode={dialog.mode}
            initialName={dialog.folder?.name}
            folderId={dialog.folder?.id}
            onClose={props.ctl.closeFolderDialog}
            onSaved={(folder) =>
              props.ctl.handleFolderSaved(folder, dialog.moveFeed)
            }
          />
        )}
      </Show>
      <FeedOptionsDialog
        open={props.ctl.optionsFeed() !== null}
        feed={props.ctl.optionsFeed()}
        onClose={props.ctl.closeFeedOptions}
        onUnsubscribe={async (feed) => {
          await deleteFeed(
            {
              unreadOnly: props.ctl.unreadOnly,
              onNavigate: props.ctl.onNavigate,
            },
            feed
          );
          if (
            props.ctl.optionsFeed()?.id === feed.id &&
            !sidebarFeeds().some((entry) => entry.id === feed.id)
          ) {
            props.ctl.closeFeedOptions();
          }
        }}
      />
      <KeyboardShortcutsDialog
        open={props.ctl.shortcutsOpen()}
        onClose={props.ctl.closeShortcuts}
      />
    </>
  );
}

function OpmlInput(props: LibraryViewProps): JSX.Element {
  return (
    <input
      ref={props.ctl.opmlInput}
      type="file"
      accept=".opml,.xml"
      class="hidden"
      onChange={props.ctl.handleOpmlChange}
    />
  );
}

export function LibraryLayout(props: LibraryViewProps): JSX.Element {
  return (
    <div class="flex h-dvh min-h-dvh flex-col overflow-hidden bg-base-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div class={gridClasses(props)}>
        <SidebarColumn ctl={props.ctl} panelRef={props.panelRef} />
        <ListPanel ctl={props.ctl} panelRef={props.panelRef} />
        <ReaderPanel ctl={props.ctl} panelRef={props.panelRef} />
      </div>
      <OpmlInput ctl={props.ctl} panelRef={props.panelRef} />
      <AddDialogs ctl={props.ctl} panelRef={props.panelRef} />
      <ManageDialogs ctl={props.ctl} panelRef={props.panelRef} />
    </div>
  );
}
