import type { JSX } from '@solidjs/web';
import { t } from '../i18n';
import { allFeedsUnreadCount, isSameScope, savedUnreadCount } from '../state';
import { MenuDivider, MenuItem } from '../ui';
import { ScopeMenuItems, ScopeRow } from './ScopeRow';
import { selectScope } from './sidebarActions';
import type { SidebarProps } from './sidebarProps';

/** `LIB-SCOPE-1`: the read-later and all-feeds scopes with their row menus. */
export function SidebarScopes(props: { state: SidebarProps }): JSX.Element {
  return (
    <nav class="flex flex-col gap-0.5">
      <AllScopeRow state={props.state} />
      <LaterScopeRow state={props.state} />
    </nav>
  );
}

function LaterScopeRow(props: { state: SidebarProps }): JSX.Element {
  return (
    <ScopeRow
      active={isSameScope(props.state.scope, { kind: 'later' })}
      scope={{ kind: 'later' }}
      icon="bookmark"
      label={t('library.laterScope')}
      count={savedUnreadCount()}
      onSelect={() => selectScope(props.state, { kind: 'later' })}
    >
      <ScopeMenuItems scope={{ kind: 'later' }} />
      <MenuDivider />
      <MenuItem opensDialog icon="plus" onSelect={props.state.onRequestAddLink}>
        {t('later.addLinkTitle')}
      </MenuItem>
    </ScopeRow>
  );
}

function AllScopeRow(props: { state: SidebarProps }): JSX.Element {
  return (
    <ScopeRow
      active={isSameScope(props.state.scope, { kind: 'all' })}
      scope={{ kind: 'all' }}
      icon="inbox"
      label={t('library.allFeedsScope')}
      count={allFeedsUnreadCount()}
      onSelect={() => selectScope(props.state, { kind: 'all' })}
    >
      <ScopeMenuItems scope={{ kind: 'all' }} />
    </ScopeRow>
  );
}
