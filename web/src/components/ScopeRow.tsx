import type { JSX } from '@solidjs/web';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  isMarkingScope,
  type LibraryScope,
  markScopeAllRead,
  triggerKindleSend,
} from '../state';
import { Icon, type IconName, Menu, MenuDivider, MenuItem } from '../ui';
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
  scope: LibraryScope;
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
      <SidebarRowEnd count={props.count} marking={isMarkingScope(props.scope)}>
        <Menu label={t('library.moreActions')} triggerClass="btn-xs">
          {props.children}
        </Menu>
      </SidebarRowEnd>
    </div>
  );
}

export interface ScopeMenuItemsProps {
  scope: LibraryScope;
  feed?: Feed | null;
}

/**
 * Shared mark-all-read, Kindle send, and sort order menu items. The unread filter lives only
 * on the list heading toggle.
 */
export function ScopeMenuItems(props: ScopeMenuItemsProps): JSX.Element {
  return (
    <>
      <MenuItem
        icon="check-double"
        onSelect={() => void markScopeAllRead(props.scope)}
      >
        {t('library.markAllRead')}
      </MenuItem>
      <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
        {t('reader.sendAsEbook')}
      </MenuItem>
      <MenuDivider />
      <ListOrderCheckbox feed={props.feed ?? null} />
    </>
  );
}
