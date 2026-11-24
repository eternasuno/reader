import type { JSX } from '@solidjs/web';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  type LibraryScope,
  markScopeAllRead,
  triggerKindleSend,
} from '../state';
import {
  Icon,
  type IconName,
  Menu,
  MenuCheckbox,
  MenuDivider,
  MenuItem,
} from '../ui';
import { ListOrderCheckbox } from './ListOrderCheckbox';
import { SidebarRowEnd } from './SidebarRowEnd';
import {
  ROW_BUTTON_CLASSES,
  ROW_CLASSES,
  rowClasses,
  rowTextClasses,
} from './sidebarClasses';

export interface ScopeRowProps {
  active: boolean;
  icon: IconName;
  label: string;
  count: number;
  onSelect: () => void;
  children?: JSX.Element;
}

/** `LIB-COUNT-1`: sidebar rows hide zero unread counts; the count swaps with the `⋯` menu. */
export function ScopeRow(props: ScopeRowProps): JSX.Element {
  return (
    <div class={[ROW_CLASSES, rowClasses(props.active)]}>
      <button
        type="button"
        class={[ROW_BUTTON_CLASSES, rowTextClasses(props.active)]}
        aria-current={props.active ? 'page' : undefined}
        onClick={props.onSelect}
      >
        <Icon name={props.icon} size={16} class="opacity-70" />
        <span class="flex-1 truncate">{props.label}</span>
      </button>
      <SidebarRowEnd count={props.count}>
        <Menu
          label={String(t('library.moreActions'))}
          align="end"
          triggerClass="btn-xs"
        >
          {props.children}
        </Menu>
      </SidebarRowEnd>
    </div>
  );
}

export interface ScopeMenuItemsProps {
  scope: LibraryScope;
  feed?: Feed | null;
  unreadOnly: boolean;
  onToggleUnread: () => void;
}

/** Shared mark-all-read, Kindle send, unread filter, and sort order menu items. */
export function ScopeMenuItems(props: ScopeMenuItemsProps): JSX.Element {
  return (
    <>
      <MenuItem
        icon="check-double"
        onSelect={() => void markScopeAllRead(props.scope)}
      >
        {String(t('library.markAllRead'))}
      </MenuItem>
      <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
        {String(t('reader.sendAsEbook'))}
      </MenuItem>
      <MenuDivider />
      <MenuCheckbox checked={props.unreadOnly} onSelect={props.onToggleUnread}>
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <ListOrderCheckbox feed={props.feed ?? null} />
    </>
  );
}
