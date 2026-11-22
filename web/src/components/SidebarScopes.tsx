import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import {
  allFeedsUnreadCount,
  markScopeAllRead,
  savedUnreadCount,
} from '../state';
import { MenuCheckbox, MenuItem } from '../ui';
import { ScopeRow } from './ScopeRow';
import { isActiveScope, selectScope, toggleUnread } from './sidebarActions';
import type { SidebarProps } from './sidebarProps';

/** `LIB-SCOPE-1`: the read-later and all-feeds scopes with their row menus. */
export function SidebarScopes(props: { state: SidebarProps }): JSX.Element {
  return (
    <nav class="flex flex-col gap-0.5">
      <ScopeRow
        active={isActiveScope(props.state, { kind: 'later' })}
        icon="bookmark"
        label={String(t('library.laterScope'))}
        count={savedUnreadCount()}
        onSelect={() => selectScope(props.state, { kind: 'later' })}
      >
        <MenuCheckbox
          checked={props.state.unreadOnly}
          onSelect={() => toggleUnread(props.state)}
        >
          {String(t('library.unreadOnly'))}
        </MenuCheckbox>
        <MenuItem onSelect={() => void markScopeAllRead({ kind: 'later' })}>
          {String(t('library.markAllRead'))}
        </MenuItem>
        <Show when={props.state.onRequestAddLink}>
          <MenuItem
            icon="plus"
            onSelect={() => props.state.onRequestAddLink?.()}
          >
            {String(t('later.addLinkTitle'))}
          </MenuItem>
        </Show>
      </ScopeRow>
      <AllScopeRow state={props.state} />
    </nav>
  );
}

function AllScopeRow(props: { state: SidebarProps }): JSX.Element {
  return (
    <ScopeRow
      active={isActiveScope(props.state, { kind: 'all' })}
      icon="inbox"
      label={String(t('library.allFeedsScope'))}
      count={allFeedsUnreadCount()}
      onSelect={() => selectScope(props.state, { kind: 'all' })}
    >
      <MenuCheckbox
        checked={props.state.unreadOnly}
        onSelect={() => toggleUnread(props.state)}
      >
        {String(t('library.unreadOnly'))}
      </MenuCheckbox>
      <MenuItem onSelect={() => void markScopeAllRead({ kind: 'all' })}>
        {String(t('library.markAllRead'))}
      </MenuItem>
    </ScopeRow>
  );
}
