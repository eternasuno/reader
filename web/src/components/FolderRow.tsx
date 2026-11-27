import type { JSX } from '@solidjs/web';
import { createUniqueId, For, Show } from 'solid-js';
import type { Folder } from '../api';
import { t } from '../i18n';
import {
  collapsedFolders,
  folderFeeds,
  folderUnreadCount,
  isMarkingScope,
  isSameScope,
  toggleFolderCollapse,
} from '../state';
import { Icon, Menu, MenuDivider, MenuItem } from '../ui';
import { FeedRow } from './FeedRow';
import { ScopeMenuItems } from './ScopeRow';
import { SidebarRowEnd } from './SidebarRowEnd';
import { deleteFolder, selectScope } from './sidebarActions';
import {
  ROW_BUTTON_CLASSES,
  ROW_CLASSES,
  rowClasses,
  rowTextClasses,
} from './sidebarClasses';
import type { SidebarProps } from './sidebarProps';

/** `FD-FOLDER-5`, `FD-MOVE-1`: collapsible folder row with its feeds indented below. */
export function FolderRow(props: {
  folder: Folder;
  state: SidebarProps;
}): JSX.Element {
  const listId = createUniqueId();
  const collapsed = () => collapsedFolders().has(props.folder.id);
  const active = () =>
    isSameScope(props.state.scope, {
      kind: 'folder',
      folderId: props.folder.id,
    });

  return (
    <div class="flex flex-col gap-0.5">
      <div class={[ROW_CLASSES, rowClasses(active())]}>
        <CollapseButton
          folder={props.folder}
          collapsed={collapsed()}
          controlsId={listId}
        />
        <FolderNameButton
          folder={props.folder}
          active={active()}
          state={props.state}
        />
        <SidebarRowEnd
          count={folderUnreadCount(props.folder.id)}
          marking={isMarkingScope({
            kind: 'folder',
            folderId: props.folder.id,
          })}
        >
          <FolderMenu folder={props.folder} state={props.state} />
        </SidebarRowEnd>
      </div>
      <Show when={!collapsed()}>
        <div
          id={listId}
          class="ml-4 flex flex-col gap-0.5 border-l border-base-300 pl-1 animate-fade-in"
        >
          <For each={folderFeeds(props.folder.id)} keyed={(feed) => feed.id}>
            {(feed) => <FeedRow feed={feed()} state={props.state} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CollapseButton(props: {
  folder: Folder;
  collapsed: boolean;
  controlsId: string;
}): JSX.Element {
  const label = () =>
    t(props.collapsed ? 'folders.expandFolder' : 'folders.collapseFolder', {
      name: props.folder.name,
    });

  return (
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square shrink-0"
      aria-label={label()}
      aria-expanded={props.collapsed ? 'false' : 'true'}
      aria-controls={props.controlsId}
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
      <span class="flex-1 truncate">{props.folder.name}</span>
    </button>
  );
}

function FolderMenu(props: {
  folder: Folder;
  state: SidebarProps;
}): JSX.Element {
  return (
    <Menu label={t('library.moreActions')} triggerClass="btn-xs">
      <ScopeMenuItems scope={{ kind: 'folder', folderId: props.folder.id }} />
      <MenuDivider />
      <MenuItem
        opensDialog
        onSelect={() => props.state.onRequestRenameFolder(props.folder)}
      >
        {t('folders.renameFolder')}
      </MenuItem>
      <MenuItem
        icon="trash"
        onSelect={() => void deleteFolder(props.state, props.folder)}
      >
        {t('folders.deleteFolder')}
      </MenuItem>
    </Menu>
  );
}
