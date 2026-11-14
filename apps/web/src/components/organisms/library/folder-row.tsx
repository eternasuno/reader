import type { Folder } from '../../../api/library';
import { IconButton } from '../../atoms/icon-button';
import { ReaderIcon } from '../../atoms/reader-icon';
import { ScopeRow } from '../../molecules/scope-row';

const FolderToggle = (props: {
  readonly name: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) => (
  <IconButton
    label={
      props.collapsed
        ? `展开目录「${props.name}」`
        : `折叠目录「${props.name}」`
    }
    expanded={!props.collapsed}
    onClick={props.onToggle}
  >
    <ReaderIcon
      name="next"
      class={props.collapsed ? 'size-4 -rotate-90' : 'size-4'}
    />
  </IconButton>
);

export const LibraryFolderRow = (props: {
  readonly folder: Folder;
  readonly count: number;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly busy: boolean;
  readonly unreadOnly: boolean;
  readonly onToggle: () => void;
  readonly onPick: () => void;
  readonly onFilter: (checked: boolean) => void;
  readonly onMarkAll: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}) => (
  <ScopeRow
    icon="folder"
    label={props.folder.name}
    count={props.count}
    active={props.active}
    leading={
      <FolderToggle
        name={props.folder.name}
        collapsed={props.collapsed}
        onToggle={props.onToggle}
      />
    }
    menu={{
      label: `「${props.folder.name}」目录操作`,
      triggerLabel: `目录「${props.folder.name}」菜单`,
      unreadOnly: props.unreadOnly,
      busy: props.busy,
      onFilter: props.onFilter,
      onMarkAll: props.onMarkAll,
      rename: {
        label: '重命名目录',
        icon: 'folder',
        onSelect: props.onRename,
      },
      remove: { label: '删除目录', icon: 'delete', onSelect: props.onRemove },
    }}
    onPick={() => props.onPick()}
  />
);
