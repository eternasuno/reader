import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  changeFeedOrder,
  folders,
  type LibraryScope,
  markLoadedRead,
  markScopeAllRead,
} from '../state';
import { Button, Icon, Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import {
  activeFeed,
  failingFeed,
  scopeTitle,
  scopeUnreadCount,
} from './articleListScope';
import { FeedDisplayRadios } from './FeedDisplayRadios';
import { retryRefresh } from './feedFailure';

const COUNT_CLASSES =
  'badge badge-sm border-0 bg-base-300 font-normal text-base-content/70 tabular-nums';

export interface ArticleListHeaderProps {
  scope: LibraryScope;
  unreadOnly: boolean;
  onToggleUnread: () => void;
  onRequestAddLink: () => void;
  onRequestMoveFeed: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

/** `LIB-COUNT-1`: scope title, unread count, and the list-level tools. */
export function ArticleListHeader(props: ArticleListHeaderProps): JSX.Element {
  return (
    <header class="flex items-center gap-1 border-b border-base-300 px-2 py-2">
      <h2 class="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
        <span class="truncate">{scopeTitle(props.scope)}</span>
        <span class={COUNT_CLASSES}>{scopeUnreadCount(props.scope)}</span>
        <Show when={failingFeed(props.scope)}>
          {(feed) => <FeedFailureMenu feed={feed()} />}
        </Show>
      </h2>
      <Button
        variant="icon"
        size="sm"
        aria-label={String(t('library.markLoadedRead'))}
        title={String(t('library.markLoadedRead'))}
        onClick={() => void markLoadedRead()}
      >
        <Icon name="check" size={18} />
      </Button>
      <ArticleHeaderMenu
        scope={props.scope}
        unreadOnly={props.unreadOnly}
        onToggleUnread={props.onToggleUnread}
        onRequestAddLink={props.onRequestAddLink}
        onRequestMoveFeed={props.onRequestMoveFeed}
        onDeleteFeed={props.onDeleteFeed}
      />
    </header>
  );
}

function ArticleHeaderMenu(props: ArticleListHeaderProps): JSX.Element {
  return (
    <Menu
      label={String(t('library.moreActions'))}
      align="end"
      triggerClass="btn-sm"
    >
      <MenuCheckbox checked={props.unreadOnly} onSelect={props.onToggleUnread}>
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <MenuItem onSelect={() => void markScopeAllRead(props.scope)}>
        {String(t('library.markAllRead'))}
      </MenuItem>
      <Show when={props.scope.kind === 'later'}>
        <MenuDivider />
        <MenuItem icon="plus" onSelect={props.onRequestAddLink}>
          {String(t('later.addLinkTitle'))}
        </MenuItem>
      </Show>
      <Show when={activeFeed(props.scope)}>
        {(feed) => (
          <FeedMenuOptions
            feed={feed()}
            onRequestMoveFeed={props.onRequestMoveFeed}
            onDeleteFeed={props.onDeleteFeed}
          />
        )}
      </Show>
    </Menu>
  );
}

interface FeedMenuOptionsProps {
  feed: Feed;
  onRequestMoveFeed: (feed: Feed) => void;
  onDeleteFeed: (feed: Feed) => void;
}

function FeedMenuOptions(props: FeedMenuOptionsProps): JSX.Element {
  return (
    <>
      <MenuDivider />
      <MenuCheckbox
        checked={props.feed.order === 'oldest'}
        onSelect={() =>
          void changeFeedOrder(
            props.feed,
            props.feed.order === 'oldest' ? 'newest' : 'oldest'
          )
        }
      >
        {String(t('feeds.oldestFirst'))}
      </MenuCheckbox>
      <FeedDisplayRadios feed={props.feed} />
      <Show when={folders().length > 0}>
        <MenuItem
          icon="folder"
          onSelect={() => props.onRequestMoveFeed(props.feed)}
        >
          {String(t('feeds.moveToFolder'))}
        </MenuItem>
      </Show>
      <MenuDivider />
      <MenuItem
        danger
        icon="trash"
        onSelect={() => props.onDeleteFeed(props.feed)}
      >
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
