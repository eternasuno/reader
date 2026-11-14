import { A, useNavigate } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { logout } from '../../../api/auth';
import { Button } from '../../atoms/button';
import { IconButton } from '../../atoms/icon-button';
import { ReaderIcon } from '../../atoms/reader-icon';
import { PopoverMenu } from '../../molecules/popover-menu';

const SignOutButton = () => {
  const navigate = useNavigate();
  const [leaving, setLeaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const signOut = async () => {
    setLeaving(true);
    setFailed(false);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setLeaving(false);
    }
  };

  return (
    <>
      <Button type="button" disabled={leaving()} onClick={() => void signOut()}>
        <ReaderIcon name="logout" />
        <span>{leaving() ? '退出中…' : '退出登录'}</span>
      </Button>
      <Show when={failed()}>
        <p role="alert" class="px-3 py-1 text-xs text-error">
          退出失败，请重试
        </p>
      </Show>
    </>
  );
};

export const LibraryAccountMenu = () => (
  <PopoverMenu
    label="用户操作"
    trigger={(target) => (
      <IconButton label="用户菜单" popoverTarget={target}>
        <ReaderIcon name="user" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <A href="/settings" onClick={close}>
            <ReaderIcon name="settings" />
            <span>设置</span>
          </A>
        </li>
        <li class="mt-2 border-t border-base-300 pt-2">
          <SignOutButton />
        </li>
      </>
    )}
  </PopoverMenu>
);
