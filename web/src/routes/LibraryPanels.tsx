import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import {
  AddLinkDialog,
  ArticleListPane,
  FolderNameDialog,
  MoveFeedDialog,
  ReaderPane,
  Sidebar,
  SubscribeFeedDialog,
} from '../components';
import { t } from '../i18n';
import { feeds as sidebarFeeds, folders as sidebarFolders } from '../state';
import { Button, Icon } from '../ui';
import type { LibraryController } from './libraryController';

export type PanelName = 'sidebar' | 'list' | 'reader';

export interface LibraryViewProps {
  ctl: LibraryController;
  panelRef: (panel: PanelName, element: HTMLDivElement) => void;
}

const GRID_CLASSES =
  'grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_24rem_minmax(0,1fr)]';

const DRAWER_CLASSES =
  'fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] bg-base-100 shadow-xl md:relative md:inset-auto md:z-auto md:w-auto md:max-w-none md:shadow-none';

interface MobileHeaderProps {
  title: string;
  drawerOpen: boolean;
  onToggle: () => void;
  headerRef: (element: HTMLElement) => void;
}

function MobileHeader(props: MobileHeaderProps): JSX.Element {
  return (
    <header
      ref={props.headerRef}
      class="flex items-center gap-2 border-b border-base-300 px-2 py-2 md:hidden"
    >
      <Button
        variant="icon"
        size="sm"
        aria-label={String(t('library.toggleNav'))}
        aria-expanded={props.drawerOpen ? 'true' : 'false'}
        onClick={props.onToggle}
      >
        <Icon name="menu" size={18} />
      </Button>
      <p class="min-w-0 flex-1 truncate text-sm font-medium">
        {String(t('common.brand'))} / {props.title}
      </p>
    </header>
  );
}

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
      visible={props.ctl.drawerOpen() ? DRAWER_CLASSES : 'hidden md:flex'}
    >
      <Sidebar
        scope={props.ctl.scope()}
        unreadOnly={props.ctl.unreadOnly()}
        onNavigate={props.ctl.onNavigate}
        onRequestAddFeed={props.ctl.requestAddFeed}
        onRequestNewFolder={props.ctl.requestNewFolder}
        onRequestRenameFolder={props.ctl.requestRenameFolder}
        onRequestMoveFeed={props.ctl.requestMoveFeed}
        onRequestImportOpml={props.ctl.requestImportOpml}
        onRequestAddLink={props.ctl.requestAddLink}
      />
    </PanelFrame>
  );
}

function SidebarColumn(props: LibraryViewProps): JSX.Element {
  return (
    <>
      <Show when={props.ctl.drawerOpen()}>
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
  const visible = (): string =>
    props.ctl.articleId() === null ? 'flex' : 'hidden xl:flex';

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
        onNavigate={props.ctl.onNavigate}
        onRequestAddLink={props.ctl.requestAddLink}
        onRequestAddFeed={props.ctl.requestAddFeed}
        onRequestRenameFolder={props.ctl.requestRenameFolder}
        onRequestMoveFeed={props.ctl.requestMoveFeed}
      />
    </PanelFrame>
  );
}

function ReaderPanel(props: LibraryViewProps): JSX.Element {
  const visible = (): string =>
    props.ctl.articleId() !== null ? 'flex' : 'hidden xl:flex';

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
    <>
      <Show when={props.ctl.folderDialog()}>
        {(dialog) => (
          <FolderNameDialog
            open={true}
            mode={dialog().mode}
            initialName={dialog().folder?.name}
            folderId={dialog().folder?.id}
            onClose={props.ctl.closeFolderDialog}
            onSaved={props.ctl.refreshSidebar}
          />
        )}
      </Show>
      <MoveFeedDialog
        open={props.ctl.moveFeed() !== null}
        feed={props.ctl.moveFeed()}
        folders={sidebarFolders()}
        onClose={props.ctl.closeMoveFeed}
        onMove={props.ctl.handleMoveFeed}
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
    <div class="flex h-dvh min-h-dvh flex-col overflow-hidden bg-base-100">
      <MobileHeader
        headerRef={props.ctl.mobileHeader}
        title={props.ctl.title()}
        drawerOpen={props.ctl.drawerOpen()}
        onToggle={props.ctl.toggleDrawer}
      />
      <div class={GRID_CLASSES}>
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
