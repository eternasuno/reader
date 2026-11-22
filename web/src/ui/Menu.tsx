import type { JSX } from '@solidjs/web';
import {
  createEffect,
  createSignal,
  createUniqueId,
  onSettled,
  Show,
} from 'solid-js';
import type { IconName } from './Icon';
import { Icon } from './Icon';

const ITEM_CLASSES =
  'flex w-full items-center gap-2 rounded-field px-3 py-2 text-left text-sm text-base-content transition-colors hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

/** A top-layer popover anchored to its trigger, so scroll containers never clip it. */
const PANEL_CLASSES =
  'inset-auto m-0 my-1 min-w-44 rounded-box border border-base-300 bg-base-100 p-1 text-base-content shadow-xl [position-try-fallbacks:flip-block,flip-inline]';

const PANEL_AREA = {
  start: '[position-area:bottom_span-right]',
  end: '[position-area:bottom_span-left]',
} as const;

const TRIGGER_CLASSES = 'btn btn-ghost btn-sm btn-square';

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

export interface MenuProps {
  children?: JSX.Element;
  /** Custom trigger contents; defaults to the `dots` icon. */
  trigger?: JSX.Element;
  /** Icon used by the default trigger. */
  icon?: IconName;
  /** Accessible label for the trigger button. */
  label?: string;
  align?: 'start' | 'end';
  /** Extra classes for the wrapping element. */
  class?: string;
  /** Extra classes for the trigger button. */
  triggerClass?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface MenuRefs {
  container?: HTMLDivElement;
  trigger?: HTMLButtonElement;
  panel?: HTMLDivElement;
}

const menuItems = (panel?: HTMLDivElement): Array<HTMLElement> =>
  panel
    ? Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
    : [];

/** Index to focus after an arrow, Home, or End key press. */
const nextIndex = (
  key: string,
  active: number,
  length: number
): number | undefined => {
  if (key === 'ArrowDown') return active < 0 ? 0 : (active + 1) % length;
  if (key === 'ArrowUp') return active <= 0 ? length - 1 : active - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return undefined;
};

const focusItem = (event: KeyboardEvent, panel: HTMLDivElement): void => {
  const items = menuItems(panel);
  if (items.length === 0) return;

  const active = items.indexOf(document.activeElement as HTMLElement);
  const index = nextIndex(event.key, active, items.length);
  if (index === undefined) return;

  event.preventDefault();
  items[index]?.focus();
};

const handleMenuKeyDown = (
  event: KeyboardEvent,
  refs: MenuRefs,
  dismiss: () => void
): void => {
  if (event.key === 'Tab') {
    dismiss();
    return;
  }
  if (refs.panel) focusItem(event, refs.panel);
};

const handleMenuClick = (event: MouseEvent, dismiss: () => void): void => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const item = target.closest('[role="menuitem"]');
  if (item && !item.hasAttribute('disabled')) dismiss();
};

interface DismissOptions {
  open: () => boolean;
  container: () => HTMLDivElement | undefined;
  dismiss: (restoreFocus?: boolean) => void;
}

/** Closes the menu on an outside press/click or Escape (`UI-FOCUS-3`). */
const useMenuDismiss = (options: DismissOptions): void => {
  const isOutside = (event: MouseEvent): boolean => {
    if (!options.open()) return false;
    const target = event.target;
    return !(target instanceof Node && options.container()?.contains(target));
  };

  const onPress = (event: MouseEvent) => {
    if (isOutside(event)) options.dismiss();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !options.open()) return;
    event.preventDefault();
    options.dismiss(true);
  };

  onSettled(() => {
    document.addEventListener('mousedown', onPress);
    document.addEventListener('click', onPress);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('click', onPress);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
};

const useMenuFocus = (open: () => boolean, refs: MenuRefs): void => {
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    queueMicrotask(() => {
      refs.panel?.showPopover();
      menuItems(refs.panel)[0]?.focus();
    });
  });
};

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
    if (props.disabled) return;
    if (open()) dismiss();
    else setOpenState(true);
  };

  useMenuDismiss({ open, container: () => refs.container, dismiss });
  useMenuFocus(open, refs);

  return { open, toggle, dismiss };
};

interface MenuPanelProps {
  label?: string;
  align?: 'start' | 'end';
  anchor: string;
  children?: JSX.Element;
  onKeyDown: (event: KeyboardEvent) => void;
  onClick: (event: MouseEvent) => void;
  panelRef: (el: HTMLDivElement) => void;
}

const MenuPanel = (props: MenuPanelProps): JSX.Element => (
  <div
    ref={props.panelRef}
    role="menu"
    popover="manual"
    aria-label={props.label}
    class={[PANEL_CLASSES, PANEL_AREA[props.align ?? 'end']]}
    style={{ 'position-anchor': props.anchor }}
    onKeyDown={props.onKeyDown}
    onClick={props.onClick}
  >
    {props.children}
  </div>
);

export function Menu(props: MenuProps): JSX.Element {
  const refs: MenuRefs = {};
  const menu = useMenuState(props, refs);
  const anchor = `--menu-${createUniqueId()}`;

  return (
    <div
      ref={(el) => {
        refs.container = el;
      }}
      class={['relative inline-block', props.class]}
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
        aria-label={props.label ?? '菜单'}
        disabled={props.disabled}
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
        <MenuPanel
          label={props.label}
          align={props.align}
          anchor={anchor}
          onKeyDown={(event) => handleMenuKeyDown(event, refs, menu.dismiss)}
          onClick={(event) => handleMenuClick(event, menu.dismiss)}
          panelRef={(el) => {
            refs.panel = el;
          }}
        >
          {props.children}
        </MenuPanel>
      </Show>
    </div>
  );
}

export interface MenuItemProps {
  children?: JSX.Element;
  icon?: IconName;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  class?: string;
}

export function MenuItem(props: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
      disabled={props.disabled}
      class={[
        ITEM_CLASSES,
        { 'text-error hover:bg-error/10': Boolean(props.danger) },
        props.class,
      ]}
      onClick={() => {
        if (!props.disabled) props.onSelect?.();
      }}
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Show when={props.icon}>
          {(name) => <Icon name={name()} size={16} />}
        </Show>
      </span>
      <span class="flex-1 truncate">{props.children}</span>
    </button>
  );
}

export interface MenuCheckboxProps {
  children?: JSX.Element;
  checked?: boolean;
  onSelect?: (checked: boolean) => void;
  disabled?: boolean;
  class?: string;
}

export function MenuCheckbox(props: MenuCheckboxProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      tabindex="-1"
      aria-checked={props.checked ? 'true' : 'false'}
      disabled={props.disabled}
      class={[ITEM_CLASSES, props.class]}
      onClick={() => {
        if (!props.disabled) props.onSelect?.(!props.checked);
      }}
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Show when={props.checked}>
          <Icon name="check" size={16} />
        </Show>
      </span>
      <span class="flex-1 truncate">{props.children}</span>
    </button>
  );
}

export interface MenuRadioProps {
  children?: JSX.Element;
  checked?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  class?: string;
}

export function MenuRadio(props: MenuRadioProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      tabindex="-1"
      aria-checked={props.checked ? 'true' : 'false'}
      disabled={props.disabled}
      class={[ITEM_CLASSES, props.class]}
      onClick={() => {
        if (!props.disabled) props.onSelect?.();
      }}
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <Show when={props.checked}>
          <Icon name="check" size={16} />
        </Show>
      </span>
      <span class="flex-1 truncate">{props.children}</span>
    </button>
  );
}

export function MenuDivider(): JSX.Element {
  return <hr class="my-1 h-px border-0 bg-base-300" />;
}
