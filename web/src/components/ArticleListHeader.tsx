import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  type LibraryScope,
  markLoadedRead,
  markScopeAllRead,
  sidebarCollapsed,
  toggleSidebarCollapse,
  triggerKindleSend,
} from '../state';
import { Button, Icon, Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import {
  activeFeed,
  failingFeed,
  scopeTitle,
  scopeUnreadCount,
} from './articleListScope';
import { FeedMoveSubpanel } from './FeedMoveSubpanel';
import { retryRefresh } from './feedFailure';
import { ListOrderCheckbox } from './ListOrderCheckbox';

const COUNT_CLASSES = 'text-sm font-normal tabular-nums text-base-content/50';

export interface ArticleListHeaderProps {
  scope: LibraryScope;
  unreadOnly: boolean;
  drawerOpen: boolean;
  onToggleNav: () => void;
  navToggleRef: (element: HTMLButtonElement) => void;
  onToggleUnread: () => void;
  onRequestAddLink: () => void;
  onMoveFeed: (feed: Feed, folderId: string | null) => Promise<void>;
  onRequestNewFolder: () => void;
  onRequestFeedOptions?: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function SidebarExpandButton(): JSX.Element {
  const handleExpand = (): void => {
    toggleSidebarCollapse();
    queueMicrotask(() =>
      document
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${String(t('library.collapseSidebar'))}"]`
        )
        ?.focus()
    );
  };

  return (
    <Show when={sidebarCollapsed()}>
      <Button
        variant="icon"
        size="sm"
        class="hidden md:inline-flex"
        aria-label={String(t('library.expandSidebar'))}
        title={String(t('library.expandSidebar'))}
        onClick={handleExpand}
      >
        <Icon name="sidebar" size={18} />
      </Button>
    </Show>
  );
}

/** `LIB-COUNT-1`: scope title, unread count, and the list-level tools. */
export function ArticleListHeader(props: ArticleListHeaderProps): JSX.Element {
  return (
    <header class="flex min-h-13 items-center gap-1 border-b border-base-300 px-2 py-1.5">
      <Button
        ref={props.navToggleRef}
        variant="icon"
        size="sm"
        class="max-md:size-10 md:hidden"
        aria-label={String(t('library.toggleNav'))}
        aria-expanded={props.drawerOpen ? 'true' : 'false'}
        onClick={props.onToggleNav}
      >
        <Icon name="sidebar" size={20} />
      </Button>
      <SidebarExpandButton />
      <h2 class="flex min-w-0 flex-1 items-center gap-2 pl-2 max-md:pl-0 text-base font-semibold">
        <span class="truncate">{scopeTitle(props.scope)}</span>
        <span class={COUNT_CLASSES}>{scopeUnreadCount(props.scope)}</span>
        <Show when={failingFeed(props.scope)}>
          {(feed) => <FeedFailureMenu feed={feed()} />}
        </Show>
      </h2>
      <Button
        variant="icon"
        size="sm"
        class="max-md:size-10"
        aria-label={String(t('library.markLoadedRead'))}
        title={String(t('library.markLoadedRead'))}
        onClick={() => void markLoadedRead()}
      >
        <Icon name="check-up" size={18} />
      </Button>
      <ArticleHeaderMenu
        scope={props.scope}
        unreadOnly={props.unreadOnly}
        drawerOpen={props.drawerOpen}
        onToggleNav={props.onToggleNav}
        navToggleRef={props.navToggleRef}
        onToggleUnread={props.onToggleUnread}
        onRequestAddLink={props.onRequestAddLink}
        onMoveFeed={props.onMoveFeed}
        onRequestNewFolder={props.onRequestNewFolder}
        onRequestFeedOptions={props.onRequestFeedOptions}
        onDeleteFeed={props.onDeleteFeed}
      />
    </header>
  );
}

function ArticleHeaderMenu(props: ArticleListHeaderProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'move'>('main');
  const feed = () => activeFeed(props.scope);

  return (
    <Menu
      label={String(t('library.moreActions'))}
      align="end"
      triggerClass="btn-sm max-md:size-10"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'move' && feed()}
        fallback={
          <ArticleHeaderMainItems
            props={props}
            onOpenMove={() => setPanel('move')}
          />
        }
      >
        {(target) => (
          <FeedMoveSubpanel
            feed={target()}
            onBack={() => setPanel('main')}
            onMove={props.onMoveFeed}
            onRequestNewFolder={props.onRequestNewFolder}
          />
        )}
      </Show>
    </Menu>
  );
}

function ArticleHeaderMainItems(props: {
  props: ArticleListHeaderProps;
  onOpenMove: () => void;
}): JSX.Element {
  return (
    <>
      <MenuItem
        icon="check-double"
        onSelect={() => void markScopeAllRead(props.props.scope)}
      >
        {String(t('library.markAllRead'))}
      </MenuItem>
      <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
        {String(t('reader.sendAsEbook'))}
      </MenuItem>
      <MenuDivider />
      <MenuCheckbox
        checked={props.props.unreadOnly}
        onSelect={props.props.onToggleUnread}
      >
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <ListOrderCheckbox feed={activeFeed(props.props.scope)} />
      <Show when={props.props.scope.kind === 'later'}>
        <MenuDivider />
        <MenuItem icon="plus" onSelect={props.props.onRequestAddLink}>
          {String(t('later.addLinkTitle'))}
        </MenuItem>
      </Show>
      <Show when={activeFeed(props.props.scope)}>
        {(feed) => (
          <FeedMenuOptions
            feed={feed()}
            onOpenMove={props.onOpenMove}
            onRequestFeedOptions={props.props.onRequestFeedOptions}
            onDeleteFeed={props.props.onDeleteFeed}
          />
        )}
      </Show>
    </>
  );
}

interface FeedMenuOptionsProps {
  feed: Feed;
  onOpenMove: () => void;
  onRequestFeedOptions?: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function FeedMenuOptions(props: FeedMenuOptionsProps): JSX.Element {
  return (
    <>
      <MenuDivider />
      <MenuItem submenu keepOpen onSelect={props.onOpenMove}>
        {String(t('feeds.moveTo'))}
      </MenuItem>
      <MenuItem onSelect={() => props.onRequestFeedOptions?.(props.feed)}>
        {String(t('feeds.feedOptions'))}
      </MenuItem>
      <MenuItem icon="trash" onSelect={() => props.onDeleteFeed(props.feed)}>
        {String(t('feeds.deleteFeed'))}
      </MenuItem>
    </>
  );
}

/** `FD-SCHED-3`: the heading warning exposes the stored error and a retry. */
function FeedFailureMenu(props: { feed: Feed }): JSX.Element {
  return (
    <Menu
      align="start"
      label={String(t('feeds.retryRefresh'))}
      triggerClass="btn-xs btn-square"
      trigger={<Icon name="warning" size={14} class="text-warning" />}
    >
      <p class="max-w-56 px-3 py-1.5 text-xs break-words text-base-content/70">
        {props.feed.lastError ?? ''}
      </p>
      <MenuItem icon="refresh" onSelect={() => void retryRefresh(props.feed)}>
        {String(t('feeds.retryRefresh'))}
      </MenuItem>
    </Menu>
  );
}
