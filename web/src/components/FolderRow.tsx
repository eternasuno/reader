import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import type { Folder } from '../api';
import { t } from '../i18n';
import {
  collapsedFolders,
  folderFeeds,
  folders,
  folderUnreadCount,
  markScopeAllRead,
  toggleFolderCollapse,
} from '../state';
import { Icon, Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import { FeedRow } from './FeedRow';
import {
  deleteFolder,
  isActiveScope,
  selectScope,
  toggleUnread,
} from './sidebarActions';
import {
  COUNT_CLASSES,
  ROW_BUTTON_CLASSES,
  ROW_CLASSES,
  rowClasses,
  rowTextClasses,
} from './sidebarClasses';
import type { SidebarProps } from './sidebarProps';

/** `folders.md:16-17`: collapsible folder row with its feeds indented below. */
export function FolderRow(props: {
  folder: Folder;
  state: SidebarProps;
}): JSX.Element {
  const collapsed = () => collapsedFolders().has(props.folder.id);
  const active = () =>
    isActiveScope(props.state, {
      kind: 'folder',
      folderId: props.folder.id,
    });

  return (
    <div class="flex flex-col gap-0.5">
      <div class={[ROW_CLASSES, rowClasses(active())]}>
        <CollapseButton folder={props.folder} collapsed={collapsed()} />
        <FolderNameButton
          folder={props.folder}
          active={active()}
          state={props.state}
        />
        <FolderMenu folder={props.folder} state={props.state} />
      </div>
      <Show when={!collapsed()}>
        <div class="ml-4 flex flex-col gap-0.5 border-l border-base-300 pl-1">
          <For each={folderFeeds(props.folder.id)}>
            {(feed) => (
              <FeedRow
                feed={feed}
                indent
                showMove={folders().length > 0}
                state={props.state}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CollapseButton(props: {
  folder: Folder;
  collapsed: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square shrink-0"
      aria-label={props.folder.name}
      aria-expanded={props.collapsed ? 'false' : 'true'}
      onClick={() => toggleFolderCollapse(props.folder.id)}
    >
      <Icon
        name="chevron-down"
        size={14}
        class={
          props.collapsed
            ? '-rotate-90 transition-transform'
            : 'transition-transform'
        }
      />
    </button>
  );
}

function FolderNameButton(props: {
  folder: Folder;
  active: boolean;
  state: SidebarProps;
}): JSX.Element {
  return (
    <button
      type="button"
      class={[ROW_BUTTON_CLASSES, 'pl-0', rowTextClasses(props.active)]}
      aria-current={props.active ? 'page' : undefined}
      onClick={() =>
        selectScope(props.state, {
          kind: 'folder',
          folderId: props.folder.id,
        })
      }
    >
      <Icon name="folder" size={16} class="text-base-content/60" />
      <span class="flex-1 truncate">{props.folder.name}</span>
      <Show when={folderUnreadCount(props.folder.id) > 0}>
        <span class={COUNT_CLASSES}>{folderUnreadCount(props.folder.id)}</span>
      </Show>
    </button>
  );
}

function FolderMenu(props: {
  folder: Folder;
  state: SidebarProps;
}): JSX.Element {
  return (
    <Menu
      label={String(t('library.moreActions'))}
      align="end"
      triggerClass="btn-xs"
    >
      <MenuCheckbox
        checked={props.state.unreadOnly}
        onSelect={() => toggleUnread(props.state)}
      >
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <MenuItem
        onSelect={() =>
          void markScopeAllRead({
            kind: 'folder',
            folderId: props.folder.id,
          })
        }
      >
        {String(t('library.markAllRead'))}
      </MenuItem>
      <MenuDivider />
      <MenuItem
        onSelect={() => props.state.onRequestRenameFolder(props.folder)}
      >
        {String(t('folders.renameFolder'))}
      </MenuItem>
      <MenuItem
        danger
        onSelect={() => void deleteFolder(props.state, props.folder)}
      >
        {String(t('folders.deleteFolder'))}
      </MenuItem>
    </Menu>
  );
}
