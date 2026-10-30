import { useNavigate } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { logout } from '../../lib/auth';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon } from '../atoms/reader-icon';
import { PopoverMenu } from '../molecules/popover-menu';

const SignOutButton = () => {
  const navigate = useNavigate();
  const [leaving, setLeaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const signOut = async (): Promise<void> => {
    setLeaving(true);
    setError('');
    try {
      await logout();
      navigate('/login');
    } catch {
      setError('退出失败，请重试');
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
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-3 py-1">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
};

export const WorkspaceAccountMenu = (props: {
  readonly onSettings: () => void;
  readonly onManage: () => void;
}) => {
  return (
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
            <Button
              type="button"
              onClick={() => {
                close();
                props.onSettings();
              }}
            >
              <ReaderIcon name="settings" />
              <span>设置</span>
            </Button>
          </li>
          <li>
            <Button
              type="button"
              onClick={() => {
                close();
                props.onManage();
              }}
            >
              <ReaderIcon name="plus" />
              <span>添加订阅</span>
            </Button>
          </li>
          <li class="mt-2 border-t border-base-300 pt-2">
            <SignOutButton />
          </li>
        </>
      )}
    </PopoverMenu>
  );
};
