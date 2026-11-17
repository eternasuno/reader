import { A, useNavigate } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { accountMessages } from '../account/messages';
import { signOut } from '../account/sign-out';
import { messageOf } from '../api/messages';
import { Button, IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { Menu } from '../ui/menu';
import { copy } from './messages';

/** The sign-out item: pending label while it runs, its wording under it on failure. */
const SignOutItem = (props: { readonly close: () => void }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();

  const leave = async (): Promise<void> => {
    props.close();
    setBusy(true);
    setFailure(undefined);

    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        busy={busy()}
        pendingLabel={accountMessages.signOutPending}
        onClick={() => void leave()}
      >
        <Icon name="logout" />
        {accountMessages.signOut}
      </Button>
      <Show when={failure()}>
        {(message) => (
          <p role="alert" class="px-3 py-1 text-xs text-error">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
};

/** The account menu of the sidebar header and the mobile bar (account.md Sign-out). */
export const AccountMenu = () => (
  <Menu
    label={copy.accountMenuLabel}
    trigger={(target) => (
      <IconButton label={accountMessages.menuTrigger} popoverTarget={target}>
        <Icon name="user" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <A href="/settings" onClick={() => close()}>
            <Icon name="settings" />
            <span>{accountMessages.menuSettings}</span>
          </A>
        </li>
        <li class="mt-2 border-t border-base-300 pt-2">
          <SignOutItem close={close} />
        </li>
      </>
    )}
  </Menu>
);
