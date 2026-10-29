import { createUniqueId, type JSX, Show } from 'solid-js';
import { Button } from '../atoms/button';
import { UnreadCount } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';

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
      <Button
        type="button"
        class="flex w-full items-center justify-start gap-3 px-3 py-2 text-left"
        disabled={props.busy}
        onClick={props.onRefresh}
      >
        <ReaderIcon name="refresh" class="size-5 shrink-0" />
        <span>刷新</span>
      </Button>
    </li>
    <li>
      <Button
        type="button"
        class="flex w-full items-center justify-start gap-3 px-3 py-2 text-left"
        disabled={props.busy}
        onClick={props.onMarkAll}
      >
        <ReaderIcon name="check" class="size-5 shrink-0" />
        <span>全部标记为已读</span>
      </Button>
    </li>
    <li class="my-1 border-t border-base-300 pt-1">
      <label class="flex w-full cursor-pointer items-center justify-start gap-3 px-3 py-2 text-left">
        <span class="grid size-5 shrink-0 place-items-center">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            checked={props.onlyUnread}
            onChange={(event) =>
              props.onOnlyUnreadChange(event.currentTarget.checked)
            }
          />
        </span>
        <span>只显示未读</span>
      </label>
    </li>
    {props.actions}
  </>
);

export const PopoverMenu = (props: {
  readonly label: string;
  readonly menuLabel: string;
  readonly triggerClass: string;
  readonly title?: string | undefined;
  readonly children: (close: () => void) => JSX.Element;
}) => {
  const id = createUniqueId();
  const anchor = `--menu-${id}`;
  let menu!: HTMLUListElement;
  const closeMenu = () => menu.hidePopover();

  return (
    <>
      <Button
        type="button"
        popovertarget={id}
        aria-label={props.label}
        title={props.title ?? '更多操作'}
        class={props.triggerClass}
        style={`anchor-name:${anchor}`}
      >
        <ReaderIcon name="more" class="size-5" />
      </Button>
      <ul
        ref={menu}
        id={id}
        popover="auto"
        aria-label={props.menuLabel}
        class="dropdown menu fixed inset-auto top-[anchor(bottom)] right-[anchor(right)] z-10 my-1 w-52 rounded-box border border-base-300 bg-base-100 p-2 text-sm text-base-content shadow-xl"
        style={`position-anchor:${anchor}`}
      >
        {props.children(closeMenu)}
      </ul>
    </>
  );
};

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
    label={`${props.label} 更多操作`}
    menuLabel={`${props.label} 操作`}
    triggerClass={`absolute top-1/2 right-0.5 grid size-8 -translate-y-1/2 place-items-center rounded-md bg-transparent p-0 opacity-0 pointer-events-none transition-opacity group-hover/nav:pointer-events-auto group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:opacity-100 group-has-[ul:popover-open]/nav:pointer-events-auto group-has-[ul:popover-open]/nav:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 ${props.active ? 'text-neutral-content' : 'text-base-content/60'}`}
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
