import { createEffect, onSettled } from 'solid-js';

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/** DOM element references owned by a {@link Menu} instance. */
export interface MenuRefs {
  container?: HTMLDivElement;
  trigger?: HTMLButtonElement;
  panel?: HTMLDivElement;
}

type PendingClick = { index: number; prev: Array<HTMLElement> };

let lastMenuTrigger: HTMLButtonElement | undefined;

export const takeMenuTrigger = (): HTMLButtonElement | undefined => {
  const trigger = lastMenuTrigger;
  lastMenuTrigger = undefined;

  return trigger;
};

export const rememberMenuTrigger = (
  event: MouseEvent,
  refs: MenuRefs
): void => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const item = target.closest<HTMLElement>('[role="menuitem"]');
  if (item && isEnabledMenuItem(item)) lastMenuTrigger = refs.trigger;
};

const isEnabledMenuItem = (el: HTMLElement): boolean =>
  !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true';

const allMenuItems = (panel?: HTMLDivElement): Array<HTMLElement> =>
  panel ? [...panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)] : [];

const menuItems = (panel?: HTMLDivElement): Array<HTMLElement> =>
  allMenuItems(panel).filter(isEnabledMenuItem);

const focusEntryOrPanel = (panel?: HTMLDivElement): void => {
  (menuItems(panel)[0] ?? panel)?.focus();
};

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

/** Handles Tab dismissal and Arrow/Home/End navigation across enabled items. */
export const handleMenuKeyDown = (
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

/** Dismisses the menu when clicking an enabled standard menuitem. */
export const handleMenuClick = (
  event: MouseEvent,
  dismiss: () => void
): void => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-keep-open="true"]')) return;

  const item = target.closest<HTMLElement>('[role="menuitem"]');
  if (item && isEnabledMenuItem(item)) dismiss();
};

/** Closes the menu on an outside press/click or Escape (`UI-FOCUS-3`). */
export const useMenuDismiss = (
  open: () => boolean,
  container: () => HTMLDivElement | undefined,
  dismiss: (restoreFocus?: boolean) => void
): void => {
  const onPress = (event: MouseEvent) => {
    const el = container();
    if (!open() || !el || event.composedPath().includes(el)) return;

    if (!(event.target instanceof Node && el.contains(event.target))) dismiss();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open()) return;

    event.preventDefault();
    dismiss(true);
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

const clickedMenuItem = (
  target: EventTarget | null,
  panel: HTMLDivElement
): HTMLElement | null => {
  if (!(target instanceof Element)) return null;

  const item = target.closest<HTMLElement>('[role="menuitem"]');

  return item && panel.contains(item) && isEnabledMenuItem(item) ? item : null;
};

const popSubmenuTarget = (
  panel: HTMLDivElement,
  stack: Array<number>,
  index: number
): HTMLElement | undefined => {
  if (stack.length > 0 && index === 0) {
    const idx = stack.pop();
    const el = idx === undefined ? undefined : allMenuItems(panel)[idx];

    return el && isEnabledMenuItem(el) ? el : undefined;
  }

  stack.push(index);

  return undefined;
};

const hasSubpanelSwitched = (
  panel: HTMLDivElement,
  prevItems: Array<HTMLElement>,
  pending: PendingClick | null
): boolean => {
  if (pending?.prev.every((el) => !el.isConnected)) return true;
  if (prevItems.length > 0 && prevItems.every((el) => !el.isConnected)) {
    return true;
  }

  return prevItems.length === 0 && document.activeElement === panel;
};

const isActiveItemValid = (panel: HTMLDivElement): boolean => {
  const active = document.activeElement;
  if (!(active instanceof Node && panel.contains(active))) return false;
  if (active === panel) return true;

  return active instanceof HTMLElement && isEnabledMenuItem(active);
};

const restoreMenuFocus = (
  panel: HTMLDivElement,
  stack: Array<number>,
  prevItems: Array<HTMLElement>,
  pending: PendingClick | null
): void => {
  if (hasSubpanelSwitched(panel, prevItems, pending)) {
    const target = pending
      ? popSubmenuTarget(panel, stack, pending.index)
      : undefined;
    (target ?? menuItems(panel)[0] ?? panel).focus();
    return;
  }

  if (!isActiveItemValid(panel)) focusEntryOrPanel(panel);
};

/** Tracks popover entry focus and subpanel transitions while open. */
export const useMenuFocus = (open: () => boolean, refs: MenuRefs): void => {
  createEffect(open, (isOpen) => {
    if (!isOpen) return;

    const stack: Array<number> = [];
    let pending: PendingClick | null = null;
    const panel = refs.panel;
    let prevItems = allMenuItems(panel);

    const onClickCapture = (event: MouseEvent) => {
      const item = panel ? clickedMenuItem(event.target, panel) : null;
      if (!item || !panel) return;

      const prev = allMenuItems(panel);
      const index = prev.indexOf(item);
      if (index !== -1) pending = { index, prev };
    };

    const observer = panel
      ? new MutationObserver(() => {
          const current = pending;
          pending = null;
          restoreMenuFocus(panel, stack, prevItems, current);
          prevItems = allMenuItems(panel);
        })
      : null;

    panel?.addEventListener('click', onClickCapture, true);
    if (panel) observer?.observe(panel, { childList: true, subtree: true });

    queueMicrotask(() => {
      if (!open()) return;

      refs.panel?.showPopover();
      prevItems = allMenuItems(refs.panel);
      focusEntryOrPanel(refs.panel);
    });

    return () => {
      panel?.removeEventListener('click', onClickCapture, true);
      observer?.disconnect();
    };
  });
};
