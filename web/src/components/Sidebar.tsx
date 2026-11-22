import type { JSX } from '@solidjs/web';
import { t } from '../i18n';
import { SidebarBrand } from './SidebarBrand';
import { SidebarFeedTree } from './SidebarFeedTree';
import { SidebarScopes } from './SidebarScopes';
import type { SidebarProps } from './sidebarProps';

export type { SidebarProps } from './sidebarProps';

/**
 * Sidebar scopes (`LIB-SCOPE-1`, `LIB-COUNT-1`), brand menu (`auth.md:16`), and the
 * feeds tree (`folders.md:16-17`).
 */
export function Sidebar(props: SidebarProps): JSX.Element {
  return (
    <aside
      class="flex h-full min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain border-r border-base-300 bg-base-100 px-2 py-3"
      aria-label={String(t('common.brand'))}
    >
      <SidebarBrand onNavigate={props.onNavigate} />
      <SidebarScopes state={props} />
      <SidebarFeedTree state={props} />
    </aside>
  );
}
