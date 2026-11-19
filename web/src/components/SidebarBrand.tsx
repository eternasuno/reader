import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { t, toggleLocale } from '../i18n';
import { signOut } from '../state';
import { Menu, MenuDivider, MenuItem } from '../ui';

/**
 * `auth.md:16`: the brand row hosts the nav menu — settings, locale switch, and
 * sign-out, which stays on the page and reports failures inline.
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
    try {
      await signOut();
      props.onNavigate('/login');
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <div class="flex items-center justify-between gap-2 px-2 pb-1">
        <span class="truncate text-lg font-semibold tracking-wide text-base-content">
          {String(t('common.brand'))}
        </span>
        <BrandMenu
          signingOut={signingOut()}
          signOutError={signOutError()}
          onNavigate={props.onNavigate}
          onSignOut={handleSignOut}
        />
      </div>
      <Show when={signOutError()}>
        <p role="alert" class="px-2 text-xs text-error">
          {String(t('auth.signOutFailed'))}
        </p>
      </Show>
    </>
  );
}

interface BrandMenuProps {
  signingOut: boolean;
  signOutError: boolean;
  onNavigate: (url: string) => void;
  onSignOut: () => void;
}

function BrandMenu(props: BrandMenuProps): JSX.Element {
  return (
    <Menu
      icon="menu"
      label={String(t('library.toggleNav'))}
      align="end"
      triggerClass="btn-xs"
    >
      <MenuItem icon="settings" onSelect={() => props.onNavigate('/settings')}>
        {String(t('library.settings'))}
      </MenuItem>
      <MenuItem onSelect={() => toggleLocale()}>
        {String(t('common.localeSwitchLabel'))}
      </MenuItem>
      <MenuDivider />
      <MenuItem disabled={props.signingOut} onSelect={props.onSignOut}>
        {String(t(props.signingOut ? 'auth.signingOut' : 'auth.signOut'))}
      </MenuItem>
      <Show when={props.signOutError}>
        <p role="alert" class="px-3 py-1 text-xs text-error">
          {String(t('auth.signOutFailed'))}
        </p>
      </Show>
    </Menu>
  );
}
