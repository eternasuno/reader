import { createEffect, createMemo, on } from 'solid-js';
import { feedOrder, loadSidebar } from '../feed';
import { ReaderPane } from '../reader';
import { AddLinkDialog, reloadSavedPageCount } from '../saved-page';
import { reloadList } from './list';
import { ListPane } from './list-pane';
import { copy } from './messages';
import { MobileBar } from './mobile-bar';
import { navOpen } from './nav';
import { keepPanelFocus } from './panel-focus';
import {
  currentScope,
  openArticleId,
  unreadFilter,
  useLibraryRoute,
} from './route';
import { scopeName } from './scope-meta';
import { LibrarySidebar } from './sidebar';

/** What a list reload depends on: the selected scope and the shared filter. */
const reloadKey = (): string => {
  const scope = currentScope();
  const id = scope.kind === 'feed' || scope.kind === 'folder' ? scope.id : '';

  return `${scope.kind}:${id}:${unreadFilter()}`;
};

/**
 * What the list also depends on: a single feed's stored order, so choosing it,
 * or the feed list arriving after the first page, lists again (FD-PREF-3).
 */
const listKey = (): string => {
  const scope = currentScope();

  return `${reloadKey()}:${scope.kind === 'feed' ? feedOrder(scope.id) : ''}`;
};

const workspaceClass =
  'group/workspace grid h-dvh grid-cols-[16rem_24rem_minmax(0,1fr)] overflow-hidden bg-[#121212] font-sans text-sm text-base-content max-xl:grid-cols-[13rem_20rem_minmax(0,1fr)] max-lg:grid-cols-[13rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[3.25rem_minmax(0,1fr)]';

/** The three columns and the mobile bar; the panels' visibility is CSS (LIB-VIEW). */
const Workspace = () => (
  <div
    class={workspaceClass}
    data-reading={String(openArticleId() !== undefined)}
    data-nav={String(navOpen())}
  >
    <MobileBar name={scopeName(currentScope())} />
    <aside
      data-panel=""
      tabindex="-1"
      class="min-h-0 min-w-0 border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:hidden max-sm:group-data-[nav=true]/workspace:flex"
    >
      <LibrarySidebar />
    </aside>
    <section
      data-panel=""
      tabindex="-1"
      aria-label={copy.listPaneLabel}
      class="min-h-0 min-w-0 overflow-hidden border-r border-base-300 bg-base-100 max-lg:group-data-[reading=true]/workspace:hidden max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden"
    >
      <ListPane />
    </section>
    <section
      data-panel=""
      tabindex="-1"
      aria-label={copy.readerPaneLabel}
      class="min-h-0 min-w-0 overflow-hidden max-lg:hidden max-lg:group-data-[reading=true]/workspace:block max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden"
    >
      <ReaderPane />
    </section>
  </div>
);

/**
 * The library screen: one shell for every scope and article route (LIB-VIEW).
 * Entering the library or a scope reloads its first page and the sidebar, and
 * nothing else reloads the list (LIB-RELOAD-1, LIB-REFRESH-1).
 */
export const LibraryPage = () => {
  useLibraryRoute();
  keepPanelFocus();

  const scopeKey = createMemo(reloadKey);
  const orderedKey = createMemo(listKey);

  createEffect(
    on(orderedKey, () => {
      void reloadList(currentScope(), unreadFilter());
    })
  );

  createEffect(
    on(scopeKey, () => {
      void loadSidebar();
      void reloadSavedPageCount();
    })
  );

  return (
    <>
      <Workspace />
      <AddLinkDialog />
    </>
  );
};
