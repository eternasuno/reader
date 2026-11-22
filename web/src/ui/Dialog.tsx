import type { JSX } from '@solidjs/web';
import { Portal } from '@solidjs/web';
import { createEffect, createUniqueId, Show } from 'solid-js';
import { Icon } from './Icon';

export interface DialogProps {
  open: boolean;
  title?: string;
  children?: JSX.Element;
  footer?: JSX.Element;
  /** Extra classes for the dialog panel. */
  class?: string;
  /** While busy, the dialog cannot be dismissed by Escape or a backdrop click. */
  busy?: boolean;
  /** While disabled, the dialog cannot be dismissed by Escape or a backdrop click. */
  disabled?: boolean;
  onClose?: () => void;
  /** Accessible label for the close button. */
  closeLabel?: string;
  /** Set to false to hide the header close button. */
  showClose?: boolean;
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
  'relative z-10 flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 text-base-content shadow-2xl focus:outline-none';

const CLOSE_CLASSES =
  'ml-auto -mr-2 btn btn-ghost btn-sm btn-square focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

const focusableIn = (panel: HTMLDivElement): Array<HTMLElement> =>
  Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

/** `UI-FOCUS-2`: Tab and Shift+Tab wrap inside the dialog panel. */
const trapTab = (event: KeyboardEvent, panel: HTMLDivElement): void => {
  const focusable = focusableIn(panel);
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const wrapBack = event.shiftKey && (active === first || active === panel);
  const wrapForward = !event.shiftKey && active === last;
  if (!wrapBack && !wrapForward) return;

  event.preventDefault();
  (wrapBack ? last : first)?.focus();
};

interface FocusOptions {
  open: () => boolean;
  panel: () => HTMLDivElement | undefined;
  dismissable: () => boolean;
  onClose: () => void;
}

/** Focuses the first field (or the panel) on open, traps Tab, and restores focus on close. */
const useDialogFocus = (options: FocusOptions): void => {
  createEffect(options.open, (open) => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && options.dismissable()) {
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  });
};

interface DialogHeaderProps {
  title?: string;
  titleId: string;
  closeLabel?: string;
  showClose?: boolean;
  onClose: () => void;
}

const DialogHeader = (props: DialogHeaderProps): JSX.Element => (
  <Show when={props.title || props.showClose !== false}>
    <div class="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
      <Show when={props.title}>
        {(title) => (
          <h2 id={props.titleId} class="text-lg font-semibold">
            {title()}
          </h2>
        )}
      </Show>
      <Show when={props.showClose !== false}>
        <button
          type="button"
          class={CLOSE_CLASSES}
          aria-label={props.closeLabel ?? '关闭'}
          onClick={() => props.onClose()}
        >
          <Icon name="close" size={18} />
        </button>
      </Show>
    </div>
  </Show>
);

export function Dialog(props: DialogProps): JSX.Element {
  let panel: HTMLDivElement | undefined;
  const titleId = createUniqueId();
  const dismissable = () => !props.busy && !props.disabled;
  const requestClose = () => {
    if (dismissable()) props.onClose?.();
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
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
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
            aria-labelledby={props.title ? titleId : undefined}
            aria-busy={props.busy ? 'true' : undefined}
            tabindex="-1"
            class={[PANEL_CLASSES, props.class]}
          >
            <DialogHeader
              title={props.title}
              titleId={titleId}
              closeLabel={props.closeLabel}
              showClose={props.showClose}
              onClose={requestClose}
            />
            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {props.children}
            </div>
            <Show when={props.footer}>
              <div class="px-5 pt-1 pb-5">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
