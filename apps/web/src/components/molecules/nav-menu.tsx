import { type JSX, Show } from 'solid-js';
import { Button } from '../atoms/button';
import { UnreadCount } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { MenuCheckbox } from './menu-checkbox';
import { PopoverMenu } from './popover-menu';

export const NavMenuMeta = (props: {
  readonly count: number | undefined;
  readonly pending: string | undefined;
}) => (
  <span
    class="ml-auto shrink-0 transition-opacity"
    classList={{
      'group-hover/nav:opacity-0 group-focus-within/nav:opacity-0 group-has-[ul:popover-open]/nav:opacity-0':
        props.pending === undefined,
    }}
  >
    <Show when={props.pending} fallback={<UnreadCount count={props.count} />}>
      {(label) => (
        <span class="text-xs text-base-content/60" role="status">
          {label()}
        </span>
      )}
    </Show>
  </span>
);

export const NavMenuActions = (props: {
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly onRefresh: () => void;
  readonly onMarkAll: () => void;
  readonly onOnlyUnreadChange: (value: boolean) => void;
  readonly actions?: JSX.Element | undefined;
}) => (
  <>
    <li>
      <Button type="button" disabled={props.busy} onClick={props.onRefresh}>
        <ReaderIcon name="refresh" />
        <span>刷新</span>
      </Button>
    </li>
    <li>
      <Button type="button" disabled={props.busy} onClick={props.onMarkAll}>
        <ReaderIcon name="checks" />
        <span>全部标记为已读</span>
      </Button>
    </li>
    <li class="my-1 border-t border-base-300">
      <MenuCheckbox
        label="只显示未读"
        checked={props.onlyUnread}
        onChange={props.onOnlyUnreadChange}
      />
    </li>
    {props.actions}
  </>
);

export const NavMenu = (props: {
  readonly label: string;
  readonly active?: boolean | undefined;
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly onRefresh: () => void;
  readonly onMarkAll: () => void;
  readonly onOnlyUnreadChange: (value: boolean) => void;
  readonly actions?: ((close: () => void) => JSX.Element) | undefined;
}) => (
  <PopoverMenu
    label={`${props.label} 操作`}
    trigger={(target) => (
      <Button
        type="button"
        popovertarget={target}
        aria-label={`${props.label} 更多操作`}
        title="更多操作"
        class={`absolute top-1/2 right-0.5 grid size-8 -translate-y-1/2 place-items-center p-0 opacity-0 transition-opacity pointer-events-none group-hover/nav:pointer-events-auto group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:opacity-100 group-has-[ul:popover-open]/nav:pointer-events-auto group-has-[ul:popover-open]/nav:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 ${props.active ? 'text-neutral-content' : 'text-base-content/60'}`}
      >
        <ReaderIcon name="more" />
      </Button>
    )}
  >
    {(closeMenu) => (
      <NavMenuActions
        busy={props.busy}
        onlyUnread={props.onlyUnread}
        onRefresh={() => {
          closeMenu();
          props.onRefresh();
        }}
        onMarkAll={() => {
          closeMenu();
          props.onMarkAll();
        }}
        onOnlyUnreadChange={props.onOnlyUnreadChange}
        actions={props.actions?.(closeMenu)}
      />
    )}
  </PopoverMenu>
);
