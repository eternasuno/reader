import { For } from 'solid-js';
import type { Counts, Feed, Scope } from '../../lib/library';
import { IconButton } from '../atoms/icon-button';
import { NavButton, UnreadCount } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { LibraryAccountMenu } from '../molecules/library-account-menu';

const iconClass = (active: boolean) =>
  `size-5 ${active ? 'text-neutral-content' : 'text-base-content/65'}`;

const ScopeRow = (props: {
  readonly icon: 'all' | 'bookmark';
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onPick: () => void;
}) => (
  <li>
    <NavButton
      class="w-full gap-3"
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon name={props.icon} class={iconClass(props.active)} />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <UnreadCount count={props.count} />
    </NavButton>
  </li>
);

const FeedRow = (props: {
  readonly feed: Feed;
  readonly count: number;
  readonly active: boolean;
  readonly busy: boolean;
  readonly onPick: () => void;
  readonly onUnsubscribe: () => void;
}) => (
  <li class="group/feed relative rounded">
    <NavButton
      class="w-full gap-3 pr-10"
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon name="feed" class={iconClass(props.active)} />
      <span class="min-w-0 flex-1 truncate" title={props.feed.url}>
        {props.feed.title}
      </span>
      <UnreadCount count={props.count} />
    </NavButton>
    <span class="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover/feed:pointer-events-auto group-hover/feed:opacity-100 group-focus-within/feed:pointer-events-auto group-focus-within/feed:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
      <IconButton
        label={`取消订阅 ${props.feed.title}`}
        title="取消订阅"
        disabled={props.busy}
        onClick={props.onUnsubscribe}
      >
        <ReaderIcon name="delete" class="size-4" />
      </IconButton>
    </span>
  </li>
);

const feedActive = (scope: Scope, id: string): boolean =>
  scope.kind === 'feeds' && scope.feedId === id;

export const LibrarySidebar = (props: {
  readonly scope: Scope;
  readonly counts: Counts;
  readonly feeds: readonly Feed[];
  readonly pending: ReadonlySet<string>;
  readonly onPickScope: (scope: Scope) => void;
  readonly onUnsubscribe: (feed: Feed) => void;
}) => (
  <nav
    aria-label="阅读导航"
    class="flex h-full min-h-0 min-w-0 flex-col gap-1 overflow-hidden px-3 pb-3"
  >
    <header class="mb-2 flex h-13 shrink-0 items-center justify-between gap-2 px-2">
      <h1 class="flex items-center gap-2.5 text-xl font-semibold tracking-[0.08em]">
        <ReaderIcon name="feed" class="size-6 text-brand" />
        留白
      </h1>
      <LibraryAccountMenu />
    </header>
    <ul aria-label="阅读来源" class="flex shrink-0 flex-col gap-1">
      <ScopeRow
        icon="bookmark"
        label="稍后阅读"
        count={props.counts.later}
        active={props.scope.kind === 'later'}
        onPick={() => props.onPickScope({ kind: 'later' })}
      />
      <ScopeRow
        icon="all"
        label="全部订阅"
        count={props.counts.feedsTotal}
        active={
          props.scope.kind === 'feeds' && props.scope.feedId === undefined
        }
        onPick={() => props.onPickScope({ kind: 'feeds' })}
      />
    </ul>
    <p class="mt-5 shrink-0 pl-3 text-xs tracking-[0.06em] text-base-content/60">
      订阅源
    </p>
    <ul
      aria-label="订阅源"
      class="mt-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
    >
      <For
        each={props.feeds}
        fallback={<li class="p-3 text-xs text-base-content/60">尚未订阅</li>}
      >
        {(feed) => (
          <FeedRow
            feed={feed}
            count={props.counts.feeds[feed.id] ?? 0}
            active={feedActive(props.scope, feed.id)}
            busy={props.pending.has(feed.id)}
            onPick={() => props.onPickScope({ kind: 'feeds', feedId: feed.id })}
            onUnsubscribe={() => props.onUnsubscribe(feed)}
          />
        )}
      </For>
    </ul>
  </nav>
);
