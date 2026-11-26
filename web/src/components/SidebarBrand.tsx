import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { t, toggleLocale } from '../i18n';
import {
  type ReaderTheme,
  readerTheme,
  setReaderTheme,
  signOut,
  toggleSidebarCollapse,
} from '../state';
import { Button, Icon, Menu, MenuDivider, MenuItem, MenuRadio } from '../ui';

const handleCollapseSidebar = (): void => {
  toggleSidebarCollapse();
  queueMicrotask(() =>
    document.querySelector<HTMLButtonElement>('[data-sidebar-expand]')?.focus()
  );
};

/**
 * `AC-AUTH-3`, `CM-I18N-1`, `LIB-VIEW-1`: the brand row hosts sidebar collapse and
 * the nav menu (settings, theme, locale switch, and sign-out with inline failure alert).
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
            class="hidden btn-xs md:inline-flex pointer-coarse:size-9"
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

const THEME_LABEL_KEYS: Record<
  ReaderTheme,
  'reader.themeAuto' | 'reader.themeLight' | 'reader.themeDark'
> = {
  auto: 'reader.themeAuto',
  light: 'reader.themeLight',
  dark: 'reader.themeDark',
};

function BrandThemeSubpanel(props: { onBack: () => void }): JSX.Element {
  return (
    <>
      <button
        type="button"
        role="menuitem"
        data-keep-open="true"
        class="mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
        onClick={props.onBack}
      >
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Icon name="arrow-left" size={18} />
        </span>
        <span>{t('reader.theme')}</span>
      </button>
      <MenuRadio
        checked={readerTheme() === 'auto'}
        onSelect={() => setReaderTheme('auto')}
      >
        {t('reader.themeAuto')}
      </MenuRadio>
      <MenuRadio
        checked={readerTheme() === 'light'}
        onSelect={() => setReaderTheme('light')}
      >
        {t('reader.themeLight')}
      </MenuRadio>
      <MenuRadio
        checked={readerTheme() === 'dark'}
        onSelect={() => setReaderTheme('dark')}
      >
        {t('reader.themeDark')}
      </MenuRadio>
    </>
  );
}

function BrandMenu(props: BrandMenuProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'theme'>('main');

  return (
    <Menu
      icon="user"
      label={t('library.appMenu')}
      triggerClass="btn-xs pointer-coarse:size-9"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'theme'}
        fallback={
          <BrandMainMenuItems
            signingOut={props.signingOut}
            onNavigate={props.onNavigate}
            onSignOut={props.onSignOut}
            onOpenTheme={() => setPanel('theme')}
          />
        }
      >
        <BrandThemeSubpanel onBack={() => setPanel('main')} />
      </Show>
    </Menu>
  );
}

function BrandMainMenuItems(props: {
  signingOut: boolean;
  onNavigate: (url: string) => void;
  onSignOut: () => void;
  onOpenTheme: () => void;
}): JSX.Element {
  return (
    <>
      <MenuItem icon="settings" onSelect={() => props.onNavigate('/settings')}>
        {t('library.settings')}
      </MenuItem>
      <button
        type="button"
        role="menuitem"
        data-keep-open="true"
        class="mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
        onClick={props.onOpenTheme}
      >
        <span class="flex size-5 shrink-0 items-center justify-center opacity-70">
          <Icon name="chevron-right" size={16} />
        </span>
        <span class="flex-1 truncate">{t('reader.theme')}</span>
        <span class="text-sm text-base-content/60">
          {t(THEME_LABEL_KEYS[readerTheme()])}
        </span>
      </button>
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
