import { useNavigate } from '@solidjs/router';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { logout } from '../../lib/auth';
import { IconButton } from '../atoms/icon-button';
import { NavButton } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';

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
      <NavButton
        class="w-full justify-between gap-3"
        disabled={leaving()}
        onClick={() => void signOut()}
      >
        <span>{leaving() ? '退出中…' : '退出登录'}</span>
        <ReaderIcon name="logout" />
      </NavButton>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-2.5 py-1">
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
  const id = createUniqueId();
  const anchor = `--account-${id}`;
  let menu!: HTMLUListElement;

  return (
    <>
      <IconButton label="用户菜单" popoverTarget={id} anchorName={anchor}>
        <ReaderIcon name="user" class="size-6" />
      </IconButton>
      <ul
        ref={menu}
        id={id}
        popover="auto"
        aria-label="用户操作"
        class="dropdown menu fixed inset-auto top-[anchor(bottom)] right-[anchor(right)] z-10 my-2 w-56 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-2 text-sm text-base-content shadow-xl"
        style={`position-anchor:${anchor}`}
      >
        <li>
          <NavButton
            class="w-full justify-between gap-3"
            onClick={() => {
              menu.hidePopover();
              props.onSettings();
            }}
          >
            设置
            <ReaderIcon name="settings" />
          </NavButton>
        </li>
        <li>
          <NavButton
            class="w-full justify-between gap-3"
            onClick={() => {
              menu.hidePopover();
              props.onManage();
            }}
          >
            添加订阅
            <ReaderIcon name="feed" />
          </NavButton>
        </li>
        <li class="mt-2 border-t border-base-300 pt-2">
          <SignOutButton />
        </li>
      </ul>
    </>
  );
};
