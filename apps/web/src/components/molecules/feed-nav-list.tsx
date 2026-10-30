import type { Feed } from '@reader/api';
import { For } from 'solid-js';
import { Button } from '../atoms/button';
import { ReaderIcon } from '../atoms/reader-icon';
import { SourceNavRow } from './source-nav';

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

const FeedNavActions = (props: {
  readonly feedKey: string;
  readonly busy: boolean;
  readonly close: () => void;
  readonly onCommand: (input: FeedNavCommand) => Promise<void>;
}) => (
  <li class="border-t border-base-300">
    <Button
      type="button"
      class="text-error"
      disabled={props.busy}
      onClick={() => {
        if (
          window.confirm(
            '取消订阅并删除该源的 RSS 文章？已保存的稍后读不会删除。'
          )
        ) {
          props.close();
          void props.onCommand({ _tag: 'Unsubscribe', key: props.feedKey });
        }
      }}
    >
      <ReaderIcon name="delete" />
      <span>删除订阅源</span>
    </Button>
  </li>
);

const FeedNavRow = (props: {
  readonly feed: Feed;
  readonly active: boolean;
  readonly reload: () => boolean;
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly pendingLabel: string | undefined;
  readonly errorMessage: string | undefined;
  readonly onPick: () => void;
  readonly onCommand: (input: FeedNavCommand) => Promise<void>;
  readonly onOnlyUnreadChange: (value: boolean) => void;
}) => (
  <SourceNavRow
    icon="feed"
    label={props.feed.title}
    active={props.active}
    count={props.feed.unreadCount}
    busy={props.busy}
    onlyUnread={props.onlyUnread}
    pending={props.pendingLabel}
    error={props.errorMessage}
    onPick={props.onPick}
    onRefresh={() =>
      void props.onCommand({
        _tag: 'Refresh',
        key: props.feed.key,
        reload: props.reload(),
      })
    }
    onMarkAll={() =>
      void props.onCommand({ _tag: 'MarkAll', key: props.feed.key })
    }
    onOnlyUnreadChange={props.onOnlyUnreadChange}
    menuActions={(close) => (
      <FeedNavActions
        close={close}
        feedKey={props.feed.key}
        busy={props.busy}
        onCommand={props.onCommand}
      />
    )}
  />
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
          reload={() =>
            props.rssActive &&
            (props.activeKey === '' || props.activeKey === feed.key)
          }
          busy={props.busy}
          onlyUnread={props.onlyUnread}
          pendingLabel={
            props.pending?.key === feed.key ? props.pending.label : undefined
          }
          errorMessage={
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
