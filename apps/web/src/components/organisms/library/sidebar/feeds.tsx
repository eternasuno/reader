import { Option } from 'effect';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import type { Counts, Feed, Folder, Scope } from '../../../../api/library';
import {
  readCollapsedFolders,
  writeCollapsedFolders,
} from '../../../../models/library/folder-collapse';
import {
  type FeedGroups,
  folderUnread,
  groupFeeds,
} from '../../../../models/library/folders';
import { Button } from '../../../atoms/button';
import { IconButton } from '../../../atoms/icon-button';
import { ReaderIcon } from '../../../atoms/reader-icon';
import { PopoverMenu } from '../../../molecules/popover-menu';
import { ScopeRow } from '../../../molecules/scope-row';
import { LibraryFolderRow } from '../folder-row';

type SidebarFeedsProps = {
  readonly folders: ReadonlyArray<Folder>;
  readonly feeds: ReadonlyArray<Feed>;
  readonly counts: Counts;
  readonly scope: Scope;
  readonly pending: ReadonlySet<string>;
  readonly unreadOnly: boolean;
  readonly onFilterScope: (scope: Scope, checked: boolean) => void;
  readonly onMarkScope: (scope: Scope) => void;
  readonly onUnsubscribe: (feed: Feed) => void;
  readonly onMoveFeed: (feed: Feed) => void;
  readonly onRenameFolder: (folder: Folder) => void;
  readonly onRemoveFolder: (folder: Folder) => void;
  readonly onPickScope: (scope: Scope) => void;
  readonly onAdd: (mode: 'article' | 'feed') => void;
  readonly onCreateFolder: () => void;
};

const folderScope = (folder: Folder): Scope => ({
  kind: 'folder',
  folderId: folder.id,
});

const feedScope = (feed: Feed): Scope => ({ kind: 'feeds', feedId: feed.id });

const feedActive = (scope: Scope, id: string): boolean =>
  scope.kind === 'feeds' && scope.feedId === id;

const AddMenu = (props: {
  readonly onAdd: (mode: 'article' | 'feed') => void;
  readonly onCreateFolder: () => void;
}) => (
  <PopoverMenu
    label="新增订阅源或目录"
    trigger={(target) => (
      <IconButton label="新增订阅源或目录" popoverTarget={target}>
        <ReaderIcon name="plus" class="size-4" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <Button
            onClick={() => {
              close();
              props.onAdd('feed');
            }}
          >
            <ReaderIcon name="feed" />
            新增 RSS 订阅
          </Button>
        </li>
        <li>
          <Button
            onClick={() => {
              close();
              props.onCreateFolder();
            }}
          >
            <ReaderIcon name="folder" />
            新建目录
          </Button>
        </li>
      </>
    )}
  </PopoverMenu>
);

const FeedRow = (props: {
  readonly feed: Feed;
  readonly context: SidebarFeedsProps;
}) => (
  <ScopeRow
    icon="feed"
    label={props.feed.title}
    title={props.feed.url}
    count={props.context.counts.feeds[props.feed.id] ?? 0}
    active={feedActive(props.context.scope, props.feed.id)}
    menu={{
      label: `「${props.feed.title}」订阅源操作`,
      triggerLabel: `订阅源「${props.feed.title}」菜单`,
      unreadOnly: props.context.unreadOnly,
      busy: props.context.pending.has(props.feed.id),
      onFilter: (checked) =>
        props.context.onFilterScope(feedScope(props.feed), checked),
      onMarkAll: () => props.context.onMarkScope(feedScope(props.feed)),
      move:
        props.context.folders.length > 0
          ? {
              label: '移动到目录',
              icon: 'folder',
              onSelect: () => props.context.onMoveFeed(props.feed),
            }
          : undefined,
      remove: {
        label: '删除 RSS 源',
        icon: 'delete',
        onSelect: () => props.context.onUnsubscribe(props.feed),
      },
    }}
    onPick={() => props.context.onPickScope(feedScope(props.feed))}
  />
);

const FolderGroup = (props: {
  readonly group: FeedGroups['groups'][number];
  readonly collapsed: boolean;
  readonly context: SidebarFeedsProps;
  readonly onToggle: () => void;
}) => (
  <li>
    <LibraryFolderRow
      folder={props.group.folder}
      count={folderUnread(
        props.context.counts,
        props.context.feeds,
        props.group.folder.id
      )}
      active={
        props.context.scope.kind === 'folder' &&
        props.context.scope.folderId === props.group.folder.id
      }
      collapsed={props.collapsed}
      busy={props.context.pending.size > 0}
      unreadOnly={props.context.unreadOnly}
      onToggle={props.onToggle}
      onPick={() => props.context.onPickScope(folderScope(props.group.folder))}
      onFilter={(checked) =>
        props.context.onFilterScope(folderScope(props.group.folder), checked)
      }
      onMarkAll={() =>
        props.context.onMarkScope(folderScope(props.group.folder))
      }
      onRename={() => props.context.onRenameFolder(props.group.folder)}
      onRemove={() => props.context.onRemoveFolder(props.group.folder)}
    />
    <Show when={!props.collapsed}>
      <ul class="pl-4">
        <For each={props.group.feeds}>
          {(feed) => (
            <li>
              <FeedRow feed={feed} context={props.context} />
            </li>
          )}
        </For>
      </ul>
    </Show>
  </li>
);

const FeedList = (props: {
  readonly groups: FeedGroups;
  readonly collapsed: ReadonlySet<string>;
  readonly context: SidebarFeedsProps;
  readonly onToggle: (folderId: string) => void;
}) => (
  <Show
    when={props.groups.groups.length > 0 || props.groups.topLevel.length > 0}
    fallback={
      <li class="px-3 py-4 text-xs leading-relaxed text-base-content/65">
        尚未订阅。点击订阅源右侧的加号添加 RSS 源。
      </li>
    }
  >
    <For each={props.groups.groups}>
      {(group) => (
        <FolderGroup
          group={group}
          collapsed={props.collapsed.has(group.folder.id)}
          context={props.context}
          onToggle={() => props.onToggle(group.folder.id)}
        />
      )}
    </For>
    <For each={props.groups.topLevel}>
      {(feed) => (
        <li>
          <FeedRow feed={feed} context={props.context} />
        </li>
      )}
    </For>
  </Show>
);

export const LibrarySidebarFeeds = (props: SidebarFeedsProps) => {
  const [collapsed, setCollapsed] = createSignal(readCollapsedFolders());
  const groups = () => groupFeeds(props.folders, props.feeds);

  const update = (next: ReadonlySet<string>) => {
    setCollapsed(next);
    writeCollapsedFolders(next);
  };

  const toggle = (folderId: string) => {
    const next = new Set(collapsed());
    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }
    update(next);
  };

  createEffect(
    on(
      () => [props.scope, props.feeds] as const,
      ([scope, feeds]) => {
        if (scope.kind !== 'feeds' || scope.feedId === undefined) return;
        const feed = feeds.find((item) => item.id === scope.feedId);
        const folderId =
          feed === undefined ? undefined : Option.getOrUndefined(feed.folderId);
        if (folderId === undefined || !collapsed().has(folderId)) return;
        update(new Set([...collapsed()].filter((id) => id !== folderId)));
      }
    )
  );

  return (
    <>
      <div class="mt-5 flex shrink-0 items-center justify-between pr-1 pl-3">
        <p class="text-xs tracking-[0.06em] text-base-content/60">订阅源</p>
        <AddMenu onAdd={props.onAdd} onCreateFolder={props.onCreateFolder} />
      </div>
      <ul
        aria-label="订阅源"
        class="mt-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
      >
        <FeedList
          groups={groups()}
          collapsed={collapsed()}
          context={props}
          onToggle={toggle}
        />
      </ul>
    </>
  );
};
