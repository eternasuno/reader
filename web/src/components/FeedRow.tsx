import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import { feedUnreadCount, isSameScope } from '../state';
import { Icon, Menu, MenuDivider, MenuItem } from '../ui';
import { deleteFeed } from './articleListActions';
import { FeedMoveSubpanel } from './FeedMoveSubpanel';
import { hasRefreshFailures, retryRefresh } from './feedFailure';
import { ScopeMenuItems } from './ScopeRow';
import { SidebarRowEnd } from './SidebarRowEnd';
import { SiteIcon } from './SiteIcon';
import { selectFeed, toggleUnread } from './sidebarActions';
import {
  ROW_BUTTON_CLASSES,
  ROW_CLASSES,
  rowClasses,
  rowTextClasses,
} from './sidebarClasses';
import type { SidebarProps } from './sidebarProps';

/**
 * `FD-PREF-1`, `FD-MOVE-1`, `FD-UNSUB-1`, `FD-SCHED-3`: feed row with unread count,
 * `⋯` menu (mark all, send, filter, order, move, feed options, delete), and failure warning.
 */
export function FeedRow(props: {
  feed: Feed;
  state: SidebarProps;
}): JSX.Element {
  return (
    <div
      class={[
        ROW_CLASSES,
        rowClasses(
          isSameScope(props.state.scope, {
            kind: 'feed',
            feedId: props.feed.id,
          })
        ),
      ]}
    >
      <FeedRowButton feed={props.feed} state={props.state} />
      <Show when={hasRefreshFailures(props.feed)}>
        <FeedFailureMenu feed={props.feed} state={props.state} />
      </Show>
      <SidebarRowEnd count={feedUnreadCount(props.feed.id)}>
        <FeedRowMenu feed={props.feed} state={props.state} />
      </SidebarRowEnd>
    </div>
  );
}

function FeedRowButton(props: {
  feed: Feed;
  state: SidebarProps;
}): JSX.Element {
  const active = () =>
    isSameScope(props.state.scope, { kind: 'feed', feedId: props.feed.id });

  return (
    <button
      type="button"
      class={[ROW_BUTTON_CLASSES, rowTextClasses(active())]}
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
      trigger={
        <span
          class="inline-flex items-center justify-center"
          title={props.feed.lastError ?? undefined}
        >
          <Icon name="warning" size={14} class="text-warning" />
        </span>
      }
    >
      <div
        role="presentation"
        class="max-w-56 px-3 py-1.5 text-xs break-words text-base-content/70"
      >
        {props.feed.lastError ?? ''}
      </div>
      <MenuItem icon="refresh" onSelect={() => void retryRefresh(props.feed)}>
        {String(t('feeds.retryRefresh'))}
      </MenuItem>
      <MenuItem
        danger
        icon="trash"
        onSelect={() =>
          void deleteFeed(
            {
              unreadOnly: () => props.state.unreadOnly,
              onNavigate: props.state.onNavigate,
            },
            props.feed
          )
        }
      >
        {String(t('feeds.deleteFeedMenu'))}
      </MenuItem>
    </Menu>
  );
}

function FeedRowMenu(props: { feed: Feed; state: SidebarProps }): JSX.Element {
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
  state: SidebarProps;
  onOpenMove: () => void;
}): JSX.Element {
  return (
    <>
      <ScopeMenuItems
        scope={{ kind: 'feed', feedId: props.feed.id }}
        feed={props.feed}
        unreadOnly={props.state.unreadOnly}
        onToggleUnread={() => toggleUnread(props.state)}
      />
      <MenuDivider />
      <MenuItem submenu keepOpen onSelect={props.onOpenMove}>
        {String(t('feeds.moveTo'))}
      </MenuItem>
      <MenuItem onSelect={() => props.state.onRequestFeedOptions?.(props.feed)}>
        {String(t('feeds.feedOptions'))}
      </MenuItem>
      <MenuItem
        icon="trash"
        onSelect={() =>
          void deleteFeed(
            {
              unreadOnly: () => props.state.unreadOnly,
              onNavigate: props.state.onNavigate,
            },
            props.feed
          )
        }
      >
        {String(t('feeds.deleteFeedMenu'))}
      </MenuItem>
    </>
  );
}
