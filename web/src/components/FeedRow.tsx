import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  feedIconCandidates,
  feedUnreadCount,
  isMarkingScope,
  isSameScope,
} from '../state';
import { Menu, MenuDivider, MenuItem } from '../ui';
import { deleteFeed } from './articleListActions';
import { FeedFailureMenu } from './FeedFailureMenu';
import { FeedMoveSubpanel } from './FeedMoveSubpanel';
import { FeedReaderModeSubpanel } from './FeedReaderModeSubpanel';
import { hasRefreshFailures } from './feedFailure';
import { ScopeMenuItems } from './ScopeRow';
import { SidebarRowEnd } from './SidebarRowEnd';
import { SiteIcon } from './SiteIcon';
import { selectFeed } from './sidebarActions';
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
        <FeedFailureMenu
          feed={props.feed}
          onDelete={(feed) =>
            void deleteFeed(
              {
                unreadOnly: () => props.state.unreadOnly,
                onNavigate: props.state.onNavigate,
              },
              feed
            )
          }
        />
      </Show>
      <SidebarRowEnd
        count={feedUnreadCount(props.feed.id)}
        marking={isMarkingScope({ kind: 'feed', feedId: props.feed.id })}
      >
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
      <SiteIcon
        srcs={feedIconCandidates(props.feed)}
        fallback="rss"
        size={16}
      />
      <span class="flex-1 truncate">{props.feed.title}</span>
    </button>
  );
}

function FeedRowMenu(props: { feed: Feed; state: SidebarProps }): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'move' | 'mode'>('main');

  return (
    <Menu
      label={t('library.moreActions')}
      triggerClass="btn-xs"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'move'}
        fallback={
          <Show
            when={panel() === 'mode'}
            fallback={
              <FeedRowMainItems
                feed={props.feed}
                state={props.state}
                onOpenMove={() => setPanel('move')}
                onOpenMode={() => setPanel('mode')}
              />
            }
          >
            <FeedReaderModeSubpanel
              feed={props.feed}
              onBack={() => setPanel('main')}
            />
          </Show>
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
  onOpenMode: () => void;
}): JSX.Element {
  return (
    <>
      <ScopeMenuItems
        scope={{ kind: 'feed', feedId: props.feed.id }}
        feed={props.feed}
      />
      <MenuDivider />
      <MenuItem submenu onSelect={props.onOpenMove}>
        {t('feeds.moveTo')}
      </MenuItem>
      <MenuItem submenu onSelect={props.onOpenMode}>
        {t('feeds.defaultDisplay')}
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
        {t('feeds.deleteFeedMenu')}
      </MenuItem>
    </>
  );
}
