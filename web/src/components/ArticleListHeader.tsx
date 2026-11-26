import type { JSX } from '@solidjs/web';
import { createSignal, flush, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  isMarkingScope,
  type LibraryScope,
  markLoadedRead,
  sidebarCollapsed,
  toggleSidebarCollapse,
} from '../state';
import { Button, Icon, Menu, MenuDivider, MenuItem } from '../ui';
import {
  activeFeed,
  failingFeed,
  scopeTitle,
  scopeUnreadCount,
} from './articleListScope';
import { FeedFailureMenu } from './FeedFailureMenu';
import { FeedMoveSubpanel } from './FeedMoveSubpanel';
import { ScopeMenuItems } from './ScopeRow';
import { MarkingIndicator } from './SidebarRowEnd';

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
  onRequestNewFolder: (feed: Feed) => void;
  onRequestFeedOptions?: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function SidebarExpandButton(): JSX.Element {
  const handleExpand = (): void => {
    toggleSidebarCollapse();
    flush();
    document
      .querySelector<HTMLButtonElement>('[data-sidebar-collapse]')
      ?.focus();
  };

  return (
    <Show when={sidebarCollapsed()}>
      <Button
        variant="icon"
        size="sm"
        class="hidden md:inline-flex"
        data-sidebar-expand=""
        aria-label={t('library.expandSidebar')}
        title={t('library.expandSidebar')}
        onClick={handleExpand}
      >
        <Icon name="sidebar" size={18} />
      </Button>
    </Show>
  );
}

function ArticleListHeading(props: {
  scope: LibraryScope;
  onDeleteFeed: (feed: Feed) => void;
}): JSX.Element {
  return (
    <div class="flex min-w-0 flex-1 items-center gap-2 pl-2 max-md:pl-0">
      <h2 class="flex min-w-0 items-center gap-2 text-base font-semibold">
        <span class="truncate">{scopeTitle(props.scope)}</span>
        <span class={COUNT_CLASSES}>{scopeUnreadCount(props.scope)}</span>
      </h2>
      <Show when={failingFeed(props.scope)}>
        {(feed) => (
          <FeedFailureMenu feed={feed()} onDelete={props.onDeleteFeed} />
        )}
      </Show>
      <Show when={isMarkingScope(props.scope)}>
        <MarkingIndicator class="shrink-0 text-base-content/60" />
      </Show>
    </div>
  );
}

function UnreadToggleButton(props: {
  unreadOnly: boolean;
  onToggleUnread: () => void;
}): JSX.Element {
  return (
    <Button
      variant="icon"
      size="sm"
      class={
        props.unreadOnly
          ? 'max-md:size-10 pointer-coarse:size-10 bg-primary/15 text-primary hover:bg-primary/20'
          : 'max-md:size-10 pointer-coarse:size-10'
      }
      aria-pressed={props.unreadOnly ? 'true' : 'false'}
      aria-label={t('library.unreadOnly')}
      title={t('library.unreadOnly')}
      onClick={props.onToggleUnread}
    >
      <Icon name="filter" size={18} />
    </Button>
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
        class="max-md:size-10 pointer-coarse:size-10 md:hidden"
        aria-label={t('library.toggleNav')}
        aria-expanded={props.drawerOpen ? 'true' : 'false'}
        onClick={props.onToggleNav}
      >
        <Icon name="sidebar" size={20} />
      </Button>
      <SidebarExpandButton />
      <ArticleListHeading
        scope={props.scope}
        onDeleteFeed={props.onDeleteFeed}
      />
      <UnreadToggleButton
        unreadOnly={props.unreadOnly}
        onToggleUnread={props.onToggleUnread}
      />
      <Button
        variant="icon"
        size="sm"
        class="max-md:size-10 pointer-coarse:size-10"
        aria-label={t('library.markLoadedRead')}
        title={t('library.markLoadedRead')}
        onClick={markLoadedRead}
      >
        <Icon name="check-up" size={18} />
      </Button>
      <ArticleHeaderMenu
        scope={props.scope}
        onRequestAddLink={props.onRequestAddLink}
        onMoveFeed={props.onMoveFeed}
        onRequestNewFolder={props.onRequestNewFolder}
        onRequestFeedOptions={props.onRequestFeedOptions}
        onDeleteFeed={props.onDeleteFeed}
      />
    </header>
  );
}

interface ArticleHeaderMenuProps {
  scope: LibraryScope;
  onRequestAddLink: () => void;
  onMoveFeed: (feed: Feed, folderId: string | null) => Promise<void>;
  onRequestNewFolder: (feed: Feed) => void;
  onRequestFeedOptions?: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function ArticleHeaderMenu(props: ArticleHeaderMenuProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'move'>('main');
  const feed = () => activeFeed(props.scope);

  return (
    <Menu
      label={t('library.moreActions')}
      triggerClass="btn-sm max-md:size-10 pointer-coarse:size-10"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'move' && feed()}
        fallback={
          <ArticleHeaderMainItems
            scope={props.scope}
            onRequestAddLink={props.onRequestAddLink}
            onOpenMove={() => setPanel('move')}
            onRequestFeedOptions={props.onRequestFeedOptions}
            onDeleteFeed={props.onDeleteFeed}
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

interface ArticleHeaderMainItemsProps {
  scope: LibraryScope;
  onRequestAddLink: () => void;
  onOpenMove: () => void;
  onRequestFeedOptions?: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function ArticleHeaderMainItems(
  props: ArticleHeaderMainItemsProps
): JSX.Element {
  return (
    <>
      <ScopeMenuItems scope={props.scope} feed={activeFeed(props.scope)} />
      <Show when={props.scope.kind === 'later'}>
        <MenuDivider />
        <MenuItem opensDialog icon="plus" onSelect={props.onRequestAddLink}>
          {t('later.addLinkTitle')}
        </MenuItem>
      </Show>
      <Show when={activeFeed(props.scope)}>
        {(feed) => (
          <FeedMenuOptions
            feed={feed()}
            onOpenMove={props.onOpenMove}
            onRequestFeedOptions={props.onRequestFeedOptions}
            onDeleteFeed={props.onDeleteFeed}
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
      <MenuItem submenu onSelect={props.onOpenMove}>
        {t('feeds.moveTo')}
      </MenuItem>
      <MenuItem
        opensDialog
        onSelect={() => props.onRequestFeedOptions?.(props.feed)}
      >
        {t('feeds.feedOptions')}
      </MenuItem>
      <MenuItem icon="trash" onSelect={() => props.onDeleteFeed(props.feed)}>
        {t('feeds.deleteFeedMenu')}
      </MenuItem>
    </>
  );
}
