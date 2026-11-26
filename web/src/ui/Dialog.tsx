import type { JSX } from '@solidjs/web';
import { Portal } from '@solidjs/web';
import { createEffect, createUniqueId, Show } from 'solid-js';
import { Icon } from './Icon';
import { takeMenuTrigger } from './menu-focus';

export interface DialogProps {
  open: boolean;
  title: string;
  children?: JSX.Element;
  /** Extra classes for the dialog panel. */
  class?: string;
  /** While busy, the dialog cannot be dismissed by Escape, close button, or a backdrop click. */
  busy?: boolean;
  onClose: () => void;
  /** Accessible label for the close button. */
  closeLabel: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Opening a form dialog focuses its first field; other dialogs focus the panel. */
const FIELD_SELECTOR =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

const PANEL_CLASSES =
  'relative z-10 flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 text-base-content shadow-2xl focus:outline-none max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)]';

const CLOSE_CLASSES =
  'ml-auto -mr-2 btn btn-ghost btn-sm btn-square pointer-coarse:size-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

const focusableIn = (panel: HTMLElement): Array<HTMLElement> =>
  Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

const wrappedFocusTarget = (
  shiftKey: boolean,
  panel: HTMLElement,
  focusable: ReadonlyArray<HTMLElement>
): HTMLElement | undefined => {
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!(active instanceof Node && panel.contains(active))) {
    return shiftKey ? last : first;
  }

  if (shiftKey && (active === first || active === panel)) return last;
  if (!shiftKey && active === last) return first;

  return undefined;
};

/** `UI-FOCUS-2`: Tab and Shift+Tab wrap inside the dialog panel. */
const trapTab = (event: KeyboardEvent, panel: HTMLElement): void => {
  const focusable = focusableIn(panel);
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();

    return;
  }

  const target = wrappedFocusTarget(event.shiftKey, panel, focusable);
  if (target === undefined) return;

  event.preventDefault();
  target.focus();
};

export interface DialogFocusOptions {
  open: () => boolean;
  panel: () => HTMLElement | undefined;
  dismissable: () => boolean;
  onClose: () => void;
}

const tryFocus = (el: HTMLElement | null | undefined): boolean => {
  if (!el?.isConnected || el === document.body) return false;

  el.focus();

  return document.activeElement === el;
};

const restoreFocus = (
  candidates: ReadonlyArray<HTMLElement | null | undefined>
): void => {
  if (candidates.some(tryFocus)) return;

  const mainLandmark = document.querySelector<HTMLElement>('main');
  mainLandmark?.setAttribute('tabindex', '-1');
  mainLandmark?.focus();
};

/** Focuses the first field (or the panel) on open, traps Tab, and restores focus on close. */
export const useDialogFocus = (options: DialogFocusOptions): void => {
  createEffect(options.open, (open) => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const menuTrigger = takeMenuTrigger();

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        options.dismissable()
      ) {
        event.preventDefault();
        options.onClose();

        return;
      }

      if (event.key !== 'Tab') return;

      const panel = options.panel();
      if (panel) trapTab(event, panel);
    };

    document.addEventListener('keydown', onKeyDown);
    queueMicrotask(() => {
      const panel = options.panel();
      const field = panel?.querySelector<HTMLElement>(FIELD_SELECTOR);
      (field ?? panel)?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus([previouslyFocused, menuTrigger]);
    };
  });
};

interface DialogHeaderProps {
  title: string;
  titleId: string;
  closeLabel: string;
  disabled?: boolean;
  onClose: () => void;
}

const DialogHeader = (props: DialogHeaderProps): JSX.Element => (
  <div class="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
    <h2 id={props.titleId} class="text-lg font-semibold">
      {props.title}
    </h2>
    <button
      type="button"
      class={CLOSE_CLASSES}
      aria-label={props.closeLabel}
      disabled={props.disabled}
      onClick={() => props.onClose()}
    >
      <Icon name="close" size={18} />
    </button>
  </div>
);

export function Dialog(props: DialogProps): JSX.Element {
  let panel: HTMLDivElement | undefined;
  const titleId = createUniqueId();
  const dismissable = () => !props.busy;
  const requestClose = () => {
    if (dismissable()) props.onClose();
  };

  useDialogFocus({
    open: () => props.open,
    panel: () => panel,
    dismissable,
    onClose: requestClose,
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div
            class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={requestClose}
          />
          <div
            ref={(el) => {
              panel = el;
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-busy={props.busy ? 'true' : undefined}
            tabindex="-1"
            class={[PANEL_CLASSES, props.class]}
          >
            <div
              class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-base-content/20 sm:hidden"
              aria-hidden="true"
            />
            <DialogHeader
              title={props.title}
              titleId={titleId}
              closeLabel={props.closeLabel}
              disabled={props.busy}
              onClose={requestClose}
            />
            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {props.children}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
