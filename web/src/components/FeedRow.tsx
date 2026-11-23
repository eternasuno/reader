import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import { feedUnreadCount, markScopeAllRead, triggerKindleSend } from '../state';
import { Icon, Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import { FeedMoveSubpanel } from './FeedMoveSubpanel';
import { hasRefreshFailures, retryRefresh } from './feedFailure';
import { ListOrderCheckbox } from './ListOrderCheckbox';
import { SidebarRowEnd } from './SidebarRowEnd';
import { SiteIcon } from './SiteIcon';
import {
  deleteFeed,
  isActiveScope,
  selectFeed,
  toggleUnread,
} from './sidebarActions';
import {
  ROW_BUTTON_CLASSES,
  ROW_CLASSES,
  rowClasses,
  rowTextClasses,
} from './sidebarClasses';
import type { SidebarProps } from './sidebarProps';

/**
 * `feeds.md:23-24`: feed row with unread count, `⋯` menu (filter, mark all, order,
 * default display, move, unsubscribe) and the `FD-SCHED-3` failure warning.
 */
export function FeedRow(props: {
  feed: Feed;
  indent?: boolean;
  showMove: boolean;
  state: SidebarProps;
}): JSX.Element {
  return (
    <div
      class={[
        ROW_CLASSES,
        rowClasses(
          isActiveScope(props.state, {
            kind: 'feed',
            feedId: props.feed.id,
          })
        ),
      ]}
    >
      <FeedRowButton
        feed={props.feed}
        indent={props.indent ?? false}
        state={props.state}
      />
      <Show when={hasRefreshFailures(props.feed)}>
        <FeedFailureMenu feed={props.feed} state={props.state} />
      </Show>
      <SidebarRowEnd count={feedUnreadCount(props.feed.id)}>
        <FeedRowMenu
          feed={props.feed}
          showMove={props.showMove}
          state={props.state}
        />
      </SidebarRowEnd>
    </div>
  );
}

function FeedRowButton(props: {
  feed: Feed;
  indent: boolean;
  state: SidebarProps;
}): JSX.Element {
  const active = () =>
    isActiveScope(props.state, { kind: 'feed', feedId: props.feed.id });

  return (
    <button
      type="button"
      class={[
        ROW_BUTTON_CLASSES,
        props.indent ? 'pl-2' : '',
        rowTextClasses(active()),
      ]}
      aria-current={active() ? 'page' : undefined}
      onClick={() => selectFeed(props.state, props.feed)}
    >
      <SiteIcon url={props.feed.url} fallback="rss" size={16} />
      <span class="flex-1 truncate">{props.feed.title}</span>
    </button>
  );
}

function FeedFailureMenu(props: {
  feed: Feed;
  state: SidebarProps;
}): JSX.Element {
  return (
    <Menu
      align="end"
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
      <MenuItem
        danger
        icon="trash"
        onSelect={() => void deleteFeed(props.state, props.feed)}
      >
        {String(t('feeds.deleteFeed'))}
      </MenuItem>
    </Menu>
  );
}

function FeedRowMenu(props: {
  feed: Feed;
  showMove: boolean;
  state: SidebarProps;
}): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'move'>('main');

  return (
    <Menu
      label={String(t('library.moreActions'))}
      align="end"
      triggerClass="btn-xs"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'move'}
        fallback={
          <FeedRowMainItems
            feed={props.feed}
            showMove={props.showMove}
            state={props.state}
            onOpenMove={() => setPanel('move')}
          />
        }
      >
        <FeedMoveSubpanel
          feed={props.feed}
          onBack={() => setPanel('main')}
          onMove={props.state.onMoveFeed}
          onRequestNewFolder={props.state.onRequestNewFolder}
        />
      </Show>
    </Menu>
  );
}

function FeedRowMainItems(props: {
  feed: Feed;
  showMove: boolean;
  state: SidebarProps;
  onOpenMove: () => void;
}): JSX.Element {
  return (
    <>
      <MenuItem
        icon="check-double"
        onSelect={() =>
          void markScopeAllRead({ kind: 'feed', feedId: props.feed.id })
        }
      >
        {String(t('library.markAllRead'))}
      </MenuItem>
      <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
        {String(t('reader.sendAsEbook'))}
      </MenuItem>
      <MenuDivider />
      <MenuCheckbox
        checked={props.state.unreadOnly}
        onSelect={() => toggleUnread(props.state)}
      >
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <ListOrderCheckbox feed={props.feed} />
      <MenuDivider />
      <Show when={props.showMove}>
        <MenuItem submenu keepOpen onSelect={props.onOpenMove}>
          {String(t('feeds.moveTo'))}
        </MenuItem>
      </Show>
      <MenuItem onSelect={() => props.state.onRequestFeedOptions?.(props.feed)}>
        {String(t('feeds.feedOptions'))}
      </MenuItem>
      <MenuItem
        icon="trash"
        onSelect={() => void deleteFeed(props.state, props.feed)}
      >
        {String(t('feeds.deleteFeed'))}
      </MenuItem>
    </>
  );
}
