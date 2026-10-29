import type { Feed } from '@reader/api';
import { For, Show } from 'solid-js';
import { Button } from '../atoms/button';
import { NavButton } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { NavMenu, NavMenuMeta } from './nav-menu';

export type FeedNavPending = {
  readonly key: string;
  readonly label: string;
};

export type FeedNavError = {
  readonly key: string;
  readonly message: string;
};

export type FeedNavCommand =
  | {
      readonly _tag: 'Refresh';
      readonly key: string;
      readonly reload: boolean;
    }
  | { readonly _tag: 'Unsubscribe'; readonly key: string }
  | { readonly _tag: 'MarkAll'; readonly key: string };

type FeedNavListProps = {
  readonly activeKey: string;
  readonly rssActive: boolean;
  readonly feeds: readonly Feed[];
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly pending: FeedNavPending | undefined;
  readonly error: FeedNavError | undefined;
  readonly onPick: (key: string) => void;
  readonly onCommand: (input: FeedNavCommand) => Promise<void>;
  readonly onOnlyUnreadChange: (value: boolean) => void;
};

const FeedNavMenu = (props: {
  readonly feed: Feed;
  readonly active: boolean;
  readonly reload: boolean;
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly onCommand: (input: FeedNavCommand) => Promise<void>;
  readonly onOnlyUnreadChange: (value: boolean) => void;
}) => {
  const unsubscribe = (close: () => void) => {
    if (
      window.confirm('取消订阅并删除该源的 RSS 文章？已保存的稍后读不会删除。')
    ) {
      close();
      void props.onCommand({ _tag: 'Unsubscribe', key: props.feed.key });
    }
  };

  return (
    <NavMenu
      label={props.feed.title}
      active={props.active}
      busy={props.busy}
      onlyUnread={props.onlyUnread}
      onRefresh={() =>
        void props.onCommand({
          _tag: 'Refresh',
          key: props.feed.key,
          reload: props.reload,
        })
      }
      onMarkAll={() =>
        void props.onCommand({ _tag: 'MarkAll', key: props.feed.key })
      }
      onOnlyUnreadChange={props.onOnlyUnreadChange}
      actions={(close) => (
        <li class="border-t border-base-300 pt-1">
          <Button
            type="button"
            class="flex w-full items-center justify-start gap-3 px-3 py-2 text-left text-error"
            disabled={props.busy}
            onClick={() => unsubscribe(close)}
          >
            <ReaderIcon name="delete" class="size-5 shrink-0" />
            <span>删除订阅源</span>
          </Button>
        </li>
      )}
    />
  );
};

const FeedNavRow = (props: {
  readonly feed: Feed;
  readonly active: boolean;
  readonly reload: boolean;
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly pendingLabel: string | undefined;
  readonly error: string | undefined;
  readonly onPick: () => void;
  readonly onCommand: (input: FeedNavCommand) => Promise<void>;
  readonly onOnlyUnreadChange: (value: boolean) => void;
}) => (
  <li
    class="group/nav relative rounded"
    aria-busy={props.pendingLabel !== undefined}
  >
    <NavButton
      class={`w-full gap-3 ${props.pendingLabel === undefined ? 'pr-2.5 pointer-coarse:pr-10' : 'pr-10'}`}
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon
        name="feed"
        class={`size-5 shrink-0 ${props.active ? 'text-neutral-content' : 'text-base-content/65'}`}
      />
      <span class="min-w-0 flex-1 truncate">{props.feed.title}</span>
      <NavMenuMeta
        pending={props.pendingLabel}
        count={props.feed.unreadCount}
      />
    </NavButton>
    <FeedNavMenu
      feed={props.feed}
      active={props.active}
      reload={props.reload}
      busy={props.busy}
      onlyUnread={props.onlyUnread}
      onCommand={props.onCommand}
      onOnlyUnreadChange={props.onOnlyUnreadChange}
    />
    <Show when={props.error}>
      {(message) => (
        <p role="alert" class="px-2.5 pb-1 text-xs text-error">
          {message()}
        </p>
      )}
    </Show>
  </li>
);

export const FeedNavList = (props: FeedNavListProps) => (
  <ul
    aria-label="订阅源"
    class="mt-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
  >
    <For
      each={props.feeds}
      fallback={<li class="p-3 text-xs text-base-content/60">尚未订阅</li>}
    >
      {(feed) => (
        <FeedNavRow
          feed={feed}
          active={feed.key === props.activeKey}
          reload={
            props.rssActive &&
            (props.activeKey === '' || props.activeKey === feed.key)
          }
          busy={props.busy}
          onlyUnread={props.onlyUnread}
          pendingLabel={
            props.pending?.key === feed.key ? props.pending.label : undefined
          }
          error={
            props.error?.key === feed.key ? props.error.message : undefined
          }
          onPick={() => props.onPick(feed.key)}
          onCommand={props.onCommand}
          onOnlyUnreadChange={props.onOnlyUnreadChange}
        />
      )}
    </For>
  </ul>
);
