import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { t, toggleLocale } from '../i18n';
import { signOut, toggleSidebarCollapse } from '../state';
import { Button, Icon, Menu, MenuDivider, MenuItem } from '../ui';
import { ReaderViewOptionsPanel } from './ReaderAppearanceMenu';

const handleCollapseSidebar = (): void => {
  toggleSidebarCollapse();
  queueMicrotask(() =>
    document.querySelector<HTMLButtonElement>('[data-sidebar-expand]')?.focus()
  );
};

/**
 * `AC-AUTH-3`, `CM-I18N-1`, `LIB-VIEW-1`: the brand row hosts sidebar collapse and
 * the nav menu (settings, view options, locale switch, and sign-out with inline failure alert).
 */
export function SidebarBrand(props: {
  onNavigate: (url: string) => void;
}): JSX.Element {
  const [signingOut, setSigningOut] = createSignal(false);
  const [signOutError, setSignOutError] = createSignal(false);

  const handleSignOut = async (): Promise<void> => {
    if (signingOut()) return;

    setSigningOut(true);
    setSignOutError(false);
    // On success `SessionGuard` replaces the route with `/login`; navigating here too would push a
    // second history entry.
    try {
      await signOut();
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <div class="flex min-h-11 items-center justify-between gap-2 px-2 pb-1">
        <span class="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-wide text-base-content">
          <Icon name="rss" size={22} strokeWidth={2.25} class="text-brand" />
          <span class="truncate">{t('common.brand')}</span>
        </span>
        <div class="flex items-center gap-1">
          <Button
            variant="icon"
            size="sm"
            class="hidden btn-xs md:inline-flex"
            data-sidebar-collapse=""
            aria-label={t('library.collapseSidebar')}
            title={t('library.collapseSidebar')}
            onClick={handleCollapseSidebar}
          >
            <Icon name="sidebar" size={16} />
          </Button>
          <BrandMenu
            signingOut={signingOut()}
            onNavigate={props.onNavigate}
            onSignOut={handleSignOut}
          />
        </div>
      </div>
      <Show when={signOutError()}>
        <p role="alert" class="px-2 text-xs text-error">
          {t('auth.signOutFailed')}
        </p>
      </Show>
    </>
  );
}

interface BrandMenuProps {
  signingOut: boolean;
  onNavigate: (url: string) => void;
  onSignOut: () => void;
}

function BrandMenu(props: BrandMenuProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'view'>('main');

  return (
    <Menu
      icon="user"
      label={t('library.appMenu')}
      triggerClass="btn-xs"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'view'}
        fallback={
          <BrandMainMenuItems
            signingOut={props.signingOut}
            onNavigate={props.onNavigate}
            onSignOut={props.onSignOut}
            onOpenView={() => setPanel('view')}
          />
        }
      >
        <ReaderViewOptionsPanel onBack={() => setPanel('main')} />
      </Show>
    </Menu>
  );
}

function BrandMainMenuItems(props: {
  signingOut: boolean;
  onNavigate: (url: string) => void;
  onSignOut: () => void;
  onOpenView: () => void;
}): JSX.Element {
  return (
    <>
      <MenuItem icon="settings" onSelect={() => props.onNavigate('/settings')}>
        {t('library.settings')}
      </MenuItem>
      <MenuItem submenu icon="typography" onSelect={props.onOpenView}>
        {t('reader.appearance')}
      </MenuItem>
      <MenuItem icon="globe" onSelect={() => toggleLocale()}>
        {t('common.localeSwitchLabel')}
      </MenuItem>
      <MenuDivider />
      <MenuItem
        icon="logout"
        disabled={props.signingOut}
        onSelect={props.onSignOut}
      >
        {t(props.signingOut ? 'auth.signingOut' : 'auth.signOut')}
      </MenuItem>
    </>
  );
}
