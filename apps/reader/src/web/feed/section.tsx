import { createEffect, createMemo, For, on, Show } from 'solid-js';
import {
  expandFolder,
  type Folder,
  FolderDialog,
  FolderMenuItems,
  folderCollapsed,
  MoveFeedDialog,
  openCreateFolder,
  toggleFolderCollapsed,
} from '../folder';
import { currentScope, ScopeRow } from '../library';
import { Button, IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { Menu } from '../ui/menu';
import { feedUnreadCount, folderUnreadCount } from './counts';
import { feedGroups } from './grouping';
import { type Feed, feeds } from './list';
import { FeedMenuItems } from './menu';
import { openSubscribe } from './subscribe';
import { SubscribeDialog } from './subscribe-dialog';

/** The always-visible plus: `新增 RSS 订阅` then `新建目录` (folders.md). */
const AddMenu = () => (
  <Menu
    label="新增订阅源或目录"
    trigger={(target) => (
      <IconButton label="新增订阅源或目录" popoverTarget={target}>
        <Icon name="plus" class="size-4" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <Button
            onClick={() => {
              close();
              openSubscribe();
            }}
          >
            <Icon name="feed" />
            新增 RSS 订阅
          </Button>
        </li>
        <li>
          <Button
            onClick={() => {
              close();
              openCreateFolder();
            }}
          >
            <Icon name="folder" />
            新建目录
          </Button>
        </li>
      </>
    )}
  </Menu>
);

/** The chevron that collapses a folder without selecting it (folders.md). */
const FolderToggle = (props: {
  readonly name: string;
  readonly folderId: string;
  readonly collapsed: boolean;
}) => (
  <IconButton
    label={
      props.collapsed
        ? `展开目录「${props.name}」`
        : `折叠目录「${props.name}」`
    }
    expanded={!props.collapsed}
    onClick={() => toggleFolderCollapsed(props.folderId)}
  >
    <Icon
      name="next"
      class={props.collapsed ? 'size-4 -rotate-90' : 'size-4'}
    />
  </IconButton>
);

const FolderRow = (props: { readonly folder: Folder }) => (
  <ScopeRow
    scope={{ kind: 'folder', id: props.folder.id }}
    name={props.folder.name}
    count={folderUnreadCount(props.folder.id)}
    leading={
      <FolderToggle
        name={props.folder.name}
        collapsed={folderCollapsed(props.folder.id)}
        folderId={props.folder.id}
      />
    }
  >
    {(close) => <FolderMenuItems folder={props.folder} close={close} />}
  </ScopeRow>
);

/** A feed row; its tooltip is the feed's address (feeds.md Interface). */
const FeedRow = (props: { readonly feed: Feed }) => (
  <ScopeRow
    scope={{ kind: 'feed', id: props.feed.id }}
    name={props.feed.title}
    title={props.feed.url}
    count={feedUnreadCount(props.feed.id)}
  >
    {(close) => <FeedMenuItems feed={props.feed} close={close} />}
  </ScopeRow>
);

/** A folder with its feeds: collapsed hides the feed rows and keeps the count. */
const FolderGroup = (props: {
  readonly folder: Folder;
  readonly feeds: ReadonlyArray<Feed>;
}) => (
  <li>
    <FolderRow folder={props.folder} />
    <Show when={!folderCollapsed(props.folder.id)}>
      <ul class="pl-4">
        <For each={props.feeds}>
          {(feed) => (
            <li>
              <FeedRow feed={feed} />
            </li>
          )}
        </For>
      </ul>
    </Show>
  </li>
);

/**
 * The `订阅源` section of the sidebar: the folders with their feeds, then the
 * top-level feeds, and the plus that adds a subscription or a folder
 * (folders.md, feeds.md). Rows are `ScopeRow`s from `library/`.
 */
export const FeedSection = () => {
  const groups = createMemo(feedGroups);
  const empty = () =>
    groups().groups.length === 0 && groups().topLevel.length === 0;

  // A feed that arrives already selected expands its folder (folders.md).
  createEffect(
    on(
      () => [currentScope(), feeds()] as const,
      ([scope, list]) => {
        if (scope.kind !== 'feed') return;

        const feed = list.find((item) => item.id === scope.id);
        const folderId = feed?.folderId;

        if (folderId !== undefined) expandFolder(folderId);
      }
    )
  );

  return (
    <>
      <div class="mt-5 flex shrink-0 items-center justify-between pr-1 pl-2.5">
        <p class="text-xs tracking-[0.06em] text-base-content/60">订阅源</p>
        <AddMenu />
      </div>
      <ul
        aria-label="订阅源"
        class="mt-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
      >
        <Show
          when={!empty()}
          fallback={
            <li class="px-3 py-4 text-xs leading-relaxed text-base-content/65">
              尚未订阅。点击订阅源右侧的加号添加 RSS 源。
            </li>
          }
        >
          <For each={groups().groups}>
            {(group) => (
              <FolderGroup folder={group.folder} feeds={group.feeds} />
            )}
          </For>
          <For each={groups().topLevel}>
            {(feed) => (
              <li>
                <FeedRow feed={feed} />
              </li>
            )}
          </For>
        </Show>
      </ul>
      <SubscribeDialog />
      <FolderDialog />
      <MoveFeedDialog />
    </>
  );
};
