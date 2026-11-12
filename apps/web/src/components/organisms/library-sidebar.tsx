import { For, Show } from 'solid-js';
import type { Counts, Feed, Scope } from '../../lib/library';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { MenuCheckbox } from '../atoms/menu-checkbox';
import { NavButton, UnreadCount } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { LibraryAccountMenu } from '../molecules/library-account-menu';
import { PopoverMenu } from '../molecules/popover-menu';

const iconClass = (active: boolean) =>
  `size-5 ${active ? 'text-neutral-content' : 'text-base-content/65'}`;

const ScopeRow = (props: {
  readonly icon: 'all' | 'bookmark' | 'feed';
  readonly label: string;
  readonly url?: string;
  readonly count: number;
  readonly active: boolean;
  readonly busy: boolean;
  readonly unreadOnly: boolean;
  readonly onFilter: (checked: boolean) => void;
  readonly onMarkAll: () => void;
  readonly onPick: () => void;
  readonly onUnsubscribe?: () => void;
  readonly onAddArticle?: () => void;
}) => (
  <li class="group/feed relative rounded">
    <NavButton
      class="w-full gap-3 pr-12"
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon name={props.icon} class={iconClass(props.active)} />
      <span class="min-w-0 flex-1 truncate" title={props.url}>
        {props.label}
      </span>
    </NavButton>
    <span class="pointer-events-none absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center group-hover/feed:invisible group-focus-within/feed:invisible group-has-[:popover-open]/feed:invisible pointer-coarse:invisible pointer-coarse:size-11 [&>span]:ml-0">
      <UnreadCount count={props.count} active={props.active} />
    </span>
    <div class="pointer-events-none absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center opacity-0 pointer-coarse:size-11 group-hover/feed:pointer-events-auto group-hover/feed:opacity-100 group-focus-within/feed:pointer-events-auto group-focus-within/feed:opacity-100 group-has-[:popover-open]/feed:pointer-events-auto group-has-[:popover-open]/feed:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
      <PopoverMenu
        label={`${props.label}订阅源操作`}
        trigger={(target) => (
          <IconButton label={`${props.label}订阅源菜单`} popoverTarget={target}>
            <ReaderIcon name="more" />
          </IconButton>
        )}
      >
        {(close) => (
          <>
            <li>
              <MenuCheckbox
                label="只显示未读"
                checked={props.unreadOnly}
                onChange={(checked) => {
                  close();
                  props.onFilter(checked);
                }}
              />
            </li>
            <li>
              <Button
                disabled={props.busy}
                onClick={() => {
                  close();
                  props.onMarkAll();
                }}
              >
                <ReaderIcon name="checks" />
                全部标记为已读
              </Button>
            </li>
            <Show when={props.onAddArticle}>
              {(add) => (
                <li class="mt-2 border-t border-base-300 pt-2">
                  <Button
                    onClick={() => {
                      close();
                      add()();
                    }}
                  >
                    <ReaderIcon name="plus" />
                    新增文章链接
                  </Button>
                </li>
              )}
            </Show>
            <Show when={props.onUnsubscribe}>
              {(unsubscribe) => (
                <li class="mt-2 border-t border-base-300 pt-2">
                  <Button
                    class="text-error"
                    disabled={props.busy}
                    onClick={() => {
                      close();
                      unsubscribe()();
                    }}
                  >
                    <ReaderIcon name="delete" />
                    删除 RSS 源
                  </Button>
                </li>
              )}
            </Show>
          </>
        )}
      </PopoverMenu>
    </div>
  </li>
);

const feedActive = (scope: Scope, id: string): boolean =>
  scope.kind === 'feeds' && scope.feedId === id;

type LibrarySidebarProps = {
  readonly scope: Scope;
  readonly counts: Counts;
  readonly feeds: ReadonlyArray<Feed>;
  readonly pending: ReadonlySet<string>;
  readonly unreadOnly: boolean;
  readonly onFilterScope: (scope: Scope, checked: boolean) => void;
  readonly onMarkScope: (scope: Scope) => void;
  readonly onUnsubscribe: (feed: Feed) => void;
  readonly onPickScope: (scope: Scope) => void;
  readonly onAdd: (mode: 'article' | 'feed') => void;
};

const PrimaryScopes = (props: LibrarySidebarProps) => (
  <ul aria-label="阅读来源" class="flex shrink-0 flex-col gap-1">
    <ScopeRow
      icon="bookmark"
      label="稍后阅读"
      onAddArticle={() => props.onAdd('article')}
      count={props.counts.later}
      active={props.scope.kind === 'later'}
      busy={props.pending.size > 0}
      unreadOnly={props.unreadOnly}
      onFilter={(checked) => props.onFilterScope({ kind: 'later' }, checked)}
      onMarkAll={() => props.onMarkScope({ kind: 'later' })}
      onPick={() => props.onPickScope({ kind: 'later' })}
    />
    <ScopeRow
      icon="all"
      label="全部订阅"
      count={props.counts.feedsTotal}
      active={props.scope.kind === 'feeds' && props.scope.feedId === undefined}
      busy={props.pending.size > 0}
      unreadOnly={props.unreadOnly}
      onFilter={(checked) => props.onFilterScope({ kind: 'feeds' }, checked)}
      onMarkAll={() => props.onMarkScope({ kind: 'feeds' })}
      onPick={() => props.onPickScope({ kind: 'feeds' })}
    />
  </ul>
);

export const LibrarySidebar = (props: LibrarySidebarProps) => (
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
    <PrimaryScopes {...props} />
    <div class="mt-5 flex shrink-0 items-center justify-between pr-1 pl-3">
      <p class="text-xs tracking-[0.06em] text-base-content/60">订阅源</p>
      <IconButton label="新增 RSS 订阅" onClick={() => props.onAdd('feed')}>
        <ReaderIcon name="plus" class="size-4" />
      </IconButton>
    </div>
    <ul
      aria-label="订阅源"
      class="mt-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
    >
      <For
        each={props.feeds}
        fallback={
          <li class="px-3 py-4 text-xs leading-relaxed text-base-content/65">
            尚未订阅。点击订阅源右侧的加号添加 RSS 源。
          </li>
        }
      >
        {(feed) => (
          <ScopeRow
            icon="feed"
            label={feed.title}
            url={feed.url}
            count={props.counts.feeds[feed.id] ?? 0}
            active={feedActive(props.scope, feed.id)}
            busy={props.pending.has(feed.id)}
            unreadOnly={props.unreadOnly}
            onFilter={(checked) =>
              props.onFilterScope({ kind: 'feeds', feedId: feed.id }, checked)
            }
            onMarkAll={() =>
              props.onMarkScope({ kind: 'feeds', feedId: feed.id })
            }
            onUnsubscribe={() => props.onUnsubscribe(feed)}
            onPick={() => props.onPickScope({ kind: 'feeds', feedId: feed.id })}
          />
        )}
      </For>
    </ul>
  </nav>
);
