import { type JSX, Show } from 'solid-js';
import { Button, IconButton } from '../ui/button';
import { Icon, type IconName } from '../ui/icon';
import { Menu } from '../ui/menu';
import { MenuCheckbox } from '../ui/menu-checkbox';
import { copy } from './messages';
import { closeNav } from './nav';
import { markAllInScope } from './read';
import {
  currentScope,
  selectScope,
  setUnreadFilter,
  unreadFilter,
} from './route';
import { type Scope, sameScope } from './scope';

export type ScopeRowProps = {
  /** The scope the row selects and its menu acts on (LIB-MENU-2). */
  readonly scope: Scope;
  readonly name: string;
  readonly count: number;
  /** The scope's own menu items, after `全部标记为已读`. */
  readonly children?: ((close: () => void) => JSX.Element) | undefined;
  readonly icon?: IconName | undefined;
  /** A tooltip for the name, such as a feed's address. */
  readonly title?: string | undefined;
  /** Something before the link, such as a folder's collapse chevron. */
  readonly leading?: JSX.Element | undefined;
};

const quoted = (name: string): string => `「${name}」`;

const triggerLabel = (scope: Scope, name: string): string =>
  scope.kind === 'folder' ? `目录${quoted(name)}菜单` : `${quoted(name)}菜单`;

const menuName = (scope: Scope, name: string): string =>
  scope.kind === 'folder' ? `${quoted(name)}目录操作` : `${quoted(name)}操作`;

const defaultIcon = (scope: Scope): IconName => {
  switch (scope.kind) {
    case 'later':
      return 'bookmark';
    case 'all':
      return 'all';
    case 'feed':
      return 'feed';
    case 'folder':
      return 'folder';
  }
};

const rowClass =
  'flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-12 pl-2.5 text-left aria-[current=page]:bg-neutral aria-[current=page]:text-neutral-content pointer-coarse:min-h-11';

const slotClass =
  'absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center pointer-coarse:size-11';

const hoverSlotClass = `${slotClass} pointer-events-none opacity-0 group-hover/scope:pointer-events-auto group-hover/scope:opacity-100 group-focus-within/scope:pointer-events-auto group-focus-within/scope:opacity-100 group-has-[:popover-open]/scope:pointer-events-auto group-has-[:popover-open]/scope:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100`;

const CountSlot = (props: {
  readonly count: number;
  readonly active: boolean;
}) => (
  <Show when={props.count > 0}>
    <span
      class="ml-auto shrink-0 text-xs tabular-nums text-base-content/65 data-[active=true]:text-neutral-content/80"
      data-active={props.active}
      title={copy.sidebarCount(props.count)}
    >
      {props.count}
      <span class="sr-only"> 篇未读文章</span>
    </span>
  </Show>
);

const ScopeMenu = (props: {
  readonly scope: Scope;
  readonly name: string;
  readonly extra?: ((close: () => void) => JSX.Element) | undefined;
}) => (
  <Menu
    label={menuName(props.scope, props.name)}
    trigger={(target) => (
      <IconButton
        label={triggerLabel(props.scope, props.name)}
        popoverTarget={target}
      >
        <Icon name="more" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <MenuCheckbox
            label={copy.filterItem}
            checked={unreadFilter()}
            onChange={(on) => {
              close();
              setUnreadFilter(on);
            }}
          />
        </li>
        <li>
          <Button
            onClick={() => {
              close();
              selectScope(props.scope);
              void markAllInScope(props.scope);
            }}
          >
            <Icon name="checks" />
            {copy.markAllItem}
          </Button>
        </li>
        {props.extra?.(close)}
      </>
    )}
  </Menu>
);

/**
 * The one sidebar row of every scope (library.md Interface): the name, the
 * count in the menu's place, and the scope's menu behind `⋯`.
 */
export const ScopeRow = (props: ScopeRowProps) => {
  const selected = () => sameScope(currentScope(), props.scope);
  const pick = () => {
    selectScope(props.scope);
    closeNav();
  };

  return (
    <div class="group/scope relative flex min-w-0 items-center rounded">
      {props.leading}
      <Button
        type="button"
        aria-current={selected() ? 'page' : undefined}
        title={props.title}
        class={rowClass}
        onClick={pick}
      >
        <Icon
          name={props.icon ?? defaultIcon(props.scope)}
          class={
            selected()
              ? 'size-5 text-neutral-content'
              : 'size-5 text-base-content/65'
          }
        />
        <span class="min-w-0 flex-1 truncate">{props.name}</span>
      </Button>
      <span
        class={`${slotClass} pointer-events-none group-hover/scope:invisible group-focus-within/scope:invisible group-has-[:popover-open]/scope:invisible pointer-coarse:invisible`}
      >
        <CountSlot count={props.count} active={selected()} />
      </span>
      <div class={hoverSlotClass}>
        <ScopeMenu
          scope={props.scope}
          name={props.name}
          extra={props.children}
        />
      </div>
    </div>
  );
};
