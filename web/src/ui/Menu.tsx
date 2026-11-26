import type { JSX } from '@solidjs/web';
import { createSignal, createUniqueId, Show } from 'solid-js';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import {
  handleMenuClick,
  handleMenuKeyDown,
  type MenuRefs,
  rememberMenuTrigger,
  useMenuDismiss,
  useMenuFocus,
} from './menu-focus';

const ITEM_CLASSES =
  'flex min-h-10 w-[calc(100%-1rem)] mx-2 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

/**
 * Menus open below the trigger extending right; `flip-inline`, `flip-block`, then both
 * keep them inside the viewport without JS coordinates.
 */
const PANEL_CLASSES =
  'inset-auto m-0 my-1 min-w-60 rounded-lg border border-base-300/80 bg-base-200 px-0 py-2 text-base-content shadow-2xl focus:outline-none [position-area:bottom_span-right] [position-try-fallbacks:flip-inline,flip-block,flip-block_flip-inline]';

const TRIGGER_CLASSES = 'btn btn-ghost btn-sm btn-square';

/** Props for the accessible popup {@link Menu} component. */
export interface MenuProps {
  children?: JSX.Element;
  trigger?: JSX.Element;
  icon?: IconName;
  label: string;
  triggerClass?: string;
  onOpenChange?: (open: boolean) => void;
}

const useMenuState = (props: MenuProps, refs: MenuRefs) => {
  const [open, setOpen] = createSignal(false);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  const dismiss = (restoreFocus = false) => {
    if (!open()) return;

    setOpenState(false);
    if (restoreFocus) refs.trigger?.focus();
  };
  const toggle = () => {
    open() ? dismiss() : setOpenState(true);
  };

  useMenuDismiss(open, () => refs.container, dismiss);
  useMenuFocus(open, refs);

  return { open, toggle, dismiss };
};

/** Accessible popover menu with keyboard navigation and subpanel focus tracking. */
export function Menu(props: MenuProps): JSX.Element {
  const refs: MenuRefs = {};
  const menu = useMenuState(props, refs);
  const anchor = `--menu-${createUniqueId()}`;

  return (
    <div
      ref={(el) => {
        refs.container = el;
      }}
      class="relative inline-block"
    >
      <button
        ref={(el) => {
          refs.trigger = el;
        }}
        type="button"
        class={[TRIGGER_CLASSES, props.triggerClass]}
        style={{ 'anchor-name': anchor }}
        aria-haspopup="menu"
        aria-expanded={menu.open() ? 'true' : 'false'}
        aria-label={props.label}
        onClick={menu.toggle}
      >
        <Show
          when={props.trigger}
          fallback={<Icon name={props.icon ?? 'dots'} size={18} />}
        >
          {props.trigger}
        </Show>
      </button>
      <Show when={menu.open()}>
        <div
          ref={(el) => {
            refs.panel = el;
            el.addEventListener(
              'click',
              (event) => rememberMenuTrigger(event, refs),
              true
            );
          }}
          role="menu"
          popover="manual"
          tabindex="-1"
          aria-label={props.label}
          class={PANEL_CLASSES}
          style={{ 'position-anchor': anchor }}
          onKeyDown={(event) => handleMenuKeyDown(event, refs, menu.dismiss)}
          onClick={(event) => handleMenuClick(event, menu.dismiss)}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

function MenuItemBody(props: {
  lead?: IconName;
  leadSize?: 16 | 18;
  leadClass: string;
  icon?: IconName;
  danger?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <>
      <span class={props.leadClass} aria-hidden="true">
        <Show when={props.lead}>
          {(name) => <Icon name={name()} size={props.leadSize ?? 16} />}
        </Show>
      </span>
      <span class="flex-1 truncate">{props.children}</span>
      <span
        class={[
          'flex size-4 shrink-0 items-center justify-center',
          props.danger ? '' : 'opacity-75',
        ]}
        aria-hidden="true"
      >
        <Show when={props.icon}>
          {(name) => <Icon name={name()} size={16} />}
        </Show>
      </span>
    </>
  );
}

interface BaseMenuItemProps {
  children?: JSX.Element;
  icon?: IconName;
  disabled?: boolean;
  'aria-disabled'?: JSX.AriaAttributes['aria-disabled'];
  class?: string;
}

const isPropDisabled = (props: BaseMenuItemProps): boolean =>
  Boolean(props.disabled) || props['aria-disabled'] === 'true';

/** Props for {@link MenuItem}. */
export interface MenuItemProps extends BaseMenuItemProps {
  onSelect?: () => void;
  danger?: boolean;
  submenu?: boolean;
  keepOpen?: boolean;
  /**
   * Marks an action that opens a dialog; focus returns to the menu trigger on close.
   * The item must open its dialog synchronously within the same task for focus return
   * to the trigger to work.
   */
  opensDialog?: boolean;
}

/** Standard action or submenu trigger inside a {@link Menu}. */
export const MenuItem = (props: MenuItemProps): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    disabled={props.disabled}
    aria-disabled={props['aria-disabled']}
    data-keep-open={props.submenu || props.keepOpen ? 'true' : undefined}
    data-opens-dialog={props.opensDialog ? 'true' : undefined}
    class={[
      ITEM_CLASSES,
      { 'text-error hover:bg-error/10': Boolean(props.danger) },
      props.class,
    ]}
    onClick={() => !isPropDisabled(props) && props.onSelect?.()}
  >
    <MenuItemBody
      lead={props.submenu ? 'chevron-right' : undefined}
      leadClass="flex size-5 shrink-0 items-center justify-center opacity-70"
      icon={props.icon}
      danger={props.danger}
    >
      {props.children}
    </MenuItemBody>
  </button>
);

/** Props for {@link MenuCheckbox}. */
export interface MenuCheckboxProps extends BaseMenuItemProps {
  checked?: boolean;
  onSelect?: (checked: boolean) => void;
}

/** Toggleable checkbox item inside a {@link Menu}. */
export const MenuCheckbox = (props: MenuCheckboxProps): JSX.Element => (
  <button
    type="button"
    role="menuitemcheckbox"
    tabindex="-1"
    aria-checked={props.checked ? 'true' : 'false'}
    disabled={props.disabled}
    aria-disabled={props['aria-disabled']}
    class={[ITEM_CLASSES, props.class]}
    onClick={() => !isPropDisabled(props) && props.onSelect?.(!props.checked)}
  >
    <MenuItemBody
      lead={props.checked ? 'checkbox-checked' : 'checkbox'}
      leadSize={18}
      leadClass="flex size-5 shrink-0 items-center justify-center opacity-90"
      icon={props.icon}
    >
      {props.children}
    </MenuItemBody>
  </button>
);

/** Props for {@link MenuRadio}. */
export interface MenuRadioProps extends BaseMenuItemProps {
  checked?: boolean;
  onSelect?: () => void;
}

/** Mutually exclusive radio item inside a {@link Menu}. */
export const MenuRadio = (props: MenuRadioProps): JSX.Element => (
  <button
    type="button"
    role="menuitemradio"
    tabindex="-1"
    aria-checked={props.checked ? 'true' : 'false'}
    disabled={props.disabled}
    aria-disabled={props['aria-disabled']}
    class={[ITEM_CLASSES, props.class]}
    onClick={() => !isPropDisabled(props) && props.onSelect?.()}
  >
    <MenuItemBody
      lead={props.checked ? 'check' : undefined}
      leadClass="flex size-4 shrink-0 items-center justify-center text-primary"
      icon={props.icon}
    >
      {props.children}
    </MenuItemBody>
  </button>
);

/** Horizontal separator between menu item groups. */
export function MenuDivider(): JSX.Element {
  return <hr class="my-2 h-px border-0 bg-base-content/15" />;
}
