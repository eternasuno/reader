import type { JSX } from '@solidjs/web';
import { t } from '../i18n';
import { Icon, type IconName, Menu } from '../ui';
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
