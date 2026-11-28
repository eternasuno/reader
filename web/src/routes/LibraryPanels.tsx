import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import {
  AddLinkDialog,
  ArticleListPane,
  FolderNameDialog,
  ReaderPane,
  Sidebar,
  SubscribeFeedDialog,
} from '../components';
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

const GRID_BASE_CLASSES =
  'grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]';

export const GRID_CLASSES = `${GRID_BASE_CLASSES} transition-[grid-template-columns] duration-200 ease-standard md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[14rem_21rem_minmax(0,1fr)] xl:grid-cols-[16rem_24rem_minmax(0,1fr)]`;

export const COLLAPSED_GRID_CLASSES = `${GRID_BASE_CLASSES} transition-[grid-template-columns] duration-200 ease-standard md:grid-cols-[0rem_minmax(0,1fr)] lg:grid-cols-[0rem_21rem_minmax(0,1fr)] xl:grid-cols-[0rem_24rem_minmax(0,1fr)]`;

const FULLSCREEN_GRID_CLASSES = GRID_BASE_CLASSES;

const isFullscreen = (props: LibraryViewProps): boolean =>
  readerFullscreen() && props.ctl.articleId() !== null;

const gridClasses = (props: LibraryViewProps): string => {
  if (isFullscreen(props)) return FULLSCREEN_GRID_CLASSES;

  return sidebarCollapsed() ? COLLAPSED_GRID_CLASSES : GRID_CLASSES;
};

const DRAWER_CLASSES =
  'flex max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-66 max-md:max-w-[85vw] max-md:rounded-r-2xl max-md:bg-base-100 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-xl max-md:transition-[transform,translate,visibility] max-md:duration-200 max-md:ease-standard';

const BACKDROP_CLASSES =
  'fixed inset-0 z-30 bg-black/60 transition-opacity duration-200 ease-standard md:hidden';

const sidebarClasses = (fullscreen: boolean, drawerOpen: boolean): string => {
  if (fullscreen) return 'hidden';

  return drawerOpen
    ? `${DRAWER_CLASSES} max-md:translate-x-0`
    : `${DRAWER_CLASSES} max-md:-translate-x-full max-md:invisible`;
};

const sidebarInert = (props: LibraryViewProps): boolean =>
  !props.ctl.drawerOpen() && (isFullscreen(props) || sidebarCollapsed());

interface PanelFrameProps {
  name: PanelName;
  visible: string;
  childWidth?: string;
  inert?: boolean;
  ariaHidden?: 'true';
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
      inert={props.inert}
      aria-hidden={props.ariaHidden}
      class={[
        'min-h-0 min-w-0 overflow-hidden outline-none *:flex-1',
        props.childWidth ?? '*:min-w-0',
        props.visible,
      ]}
    >
      {props.children}
    </div>
  );
}

function SidebarPanel(props: LibraryViewProps): JSX.Element {
  const inert = (): boolean => sidebarInert(props);

  return (
    <PanelFrame
      name="sidebar"
      panelRef={(element) => props.panelRef('sidebar', element)}
      visible={sidebarClasses(isFullscreen(props), props.ctl.drawerOpen())}
      childWidth="*:min-w-0 *:md:min-w-[15rem] *:lg:min-w-[14rem] *:xl:min-w-[16rem]"
      inert={inert()}
      ariaHidden={inert() ? 'true' : undefined}
    >
      <Sidebar
        scope={props.ctl.scope()}
        unreadOnly={props.ctl.unreadOnly()}
        onNavigate={props.ctl.onNavigate}
        onRequestAddFeed={props.ctl.requestAddFeed}
        onRequestNewFolder={props.ctl.requestNewFolder}
        onRequestRenameFolder={props.ctl.requestRenameFolder}
        onMoveFeed={props.ctl.handleMoveFeed}
        onRequestImportOpml={props.ctl.requestImportOpml}
        onRequestAddLink={props.ctl.requestAddLink}
      />
    </PanelFrame>
  );
}

function SidebarColumn(props: LibraryViewProps): JSX.Element {
  const backdropOpen = (): boolean =>
    !isFullscreen(props) && props.ctl.drawerOpen();

  return (
    <>
      <button
        type="button"
        class={
          backdropOpen()
            ? `${BACKDROP_CLASSES} opacity-100`
            : `${BACKDROP_CLASSES} pointer-events-none opacity-0`
        }
        inert={!backdropOpen()}
        aria-hidden={backdropOpen() ? undefined : 'true'}
        aria-label={t('library.closeNav')}
        onClick={props.ctl.closeDrawer}
      />
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
