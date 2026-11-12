import { type JSX, Show } from 'solid-js';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { MenuCheckbox } from '../atoms/menu-checkbox';
import { NavButton, UnreadCount } from '../atoms/nav-item';
import { ReaderIcon, type ReaderIconName } from '../atoms/reader-icon';
import { PopoverMenu } from './popover-menu';

export type ScopeMenuAction = {
  readonly label: string;
  readonly icon: ReaderIconName;
  readonly onSelect: () => void;
};

export type ScopeMenu = {
  readonly label: string;
  readonly triggerLabel: string;
  readonly unreadOnly: boolean;
  readonly busy: boolean;
  readonly onFilter: (checked: boolean) => void;
  readonly onMarkAll: () => void;
  readonly createArticle?: ScopeMenuAction | undefined;
  readonly move?: ScopeMenuAction | undefined;
  readonly rename?: ScopeMenuAction | undefined;
  readonly remove?: ScopeMenuAction | undefined;
};

const iconClass = (active: boolean) =>
  `size-5 ${active ? 'text-neutral-content' : 'text-base-content/65'}`;

const separatedClass = 'mt-2 border-t border-base-300 pt-2';

const MenuItem = (props: {
  readonly action: ScopeMenuAction;
  readonly close: () => void;
  readonly class?: string | undefined;
  readonly danger?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}) => (
  <li class={props.class}>
    <Button
      class={props.danger ? 'text-error' : undefined}
      disabled={props.disabled}
      onClick={() => {
        props.close();
        props.action.onSelect();
      }}
    >
      <ReaderIcon name={props.action.icon} />
      {props.action.label}
    </Button>
  </li>
);

const MenuItems = (props: {
  readonly menu: ScopeMenu;
  readonly close: () => void;
}) => (
  <>
    <li>
      <MenuCheckbox
        label="只显示未读"
        checked={props.menu.unreadOnly}
        onChange={(checked) => {
          props.close();
          props.menu.onFilter(checked);
        }}
      />
    </li>
    <li>
      <Button
        disabled={props.menu.busy}
        onClick={() => {
          props.close();
          props.menu.onMarkAll();
        }}
      >
        <ReaderIcon name="checks" />
        全部标记为已读
      </Button>
    </li>
    <Show when={props.menu.createArticle}>
      {(action) => <MenuItem action={action()} close={props.close} />}
    </Show>
    <Show when={props.menu.move}>
      {(action) => <MenuItem action={action()} close={props.close} />}
    </Show>
    <Show when={props.menu.rename}>
      {(action) => <MenuItem action={action()} close={props.close} />}
    </Show>
    <Show when={props.menu.remove}>
      {(action) => (
        <MenuItem
          action={action()}
          close={props.close}
          class={separatedClass}
          danger
          disabled={props.menu.busy}
        />
      )}
    </Show>
  </>
);

const ScopeMenuPopover = (props: { readonly menu: ScopeMenu }) => (
  <PopoverMenu
    label={props.menu.label}
    trigger={(target) => (
      <IconButton label={props.menu.triggerLabel} popoverTarget={target}>
        <ReaderIcon name="more" />
      </IconButton>
    )}
  >
    {(close) => <MenuItems menu={props.menu} close={close} />}
  </PopoverMenu>
);

export const LibraryScopeRow = (props: {
  readonly icon: ReaderIconName;
  readonly label: string;
  readonly title?: string | undefined;
  readonly count: number;
  readonly active: boolean;
  readonly leading?: JSX.Element;
  readonly menu: ScopeMenu;
  readonly onPick: () => void;
}) => (
  <div class="group/feed relative flex min-w-0 items-center rounded">
    {props.leading}
    <NavButton
      class="min-w-0 flex-1 gap-3 pr-12"
      active={props.active}
      onClick={() => props.onPick()}
    >
      <ReaderIcon name={props.icon} class={iconClass(props.active)} />
      <span class="min-w-0 flex-1 truncate" title={props.title}>
        {props.label}
      </span>
    </NavButton>
    <span class="pointer-events-none absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center group-hover/feed:invisible group-focus-within/feed:invisible group-has-[:popover-open]/feed:invisible pointer-coarse:invisible pointer-coarse:size-11 [&>span]:ml-0">
      <UnreadCount count={props.count} active={props.active} />
    </span>
    <div class="pointer-events-none absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center opacity-0 pointer-coarse:size-11 group-hover/feed:pointer-events-auto group-hover/feed:opacity-100 group-focus-within/feed:pointer-events-auto group-focus-within/feed:opacity-100 group-has-[:popover-open]/feed:pointer-events-auto group-has-[:popover-open]/feed:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
      <ScopeMenuPopover menu={props.menu} />
    </div>
  </div>
);
