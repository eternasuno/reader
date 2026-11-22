import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { IconName } from './Icon';
import { Icon } from './Icon';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  variant: ToastVariant;
}

/** `LIB-TOAST-1`: one toast auto-dismissed after 6 seconds. */
export const TOAST_DURATION_MS = 6000;

let nextId = 0;
let activeToast: ToastMessage | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
const [version, setVersion] = createSignal(0);

const notify = () => {
  setVersion((value) => value + 1);
};

const clearTimer = () => {
  if (dismissTimer === undefined) return;
  clearTimeout(dismissTimer);
  dismissTimer = undefined;
};

/**
 * Shows a toast, replacing any visible one and resetting the auto-dismiss timer.
 * `LIB-TOAST-1`: at most one toast is visible at a time.
 */
export function showToast(
  message: string,
  variant: ToastVariant = 'info'
): void {
  clearTimer();
  nextId += 1;
  activeToast = { id: nextId, message, variant };
  notify();
  dismissTimer = setTimeout(() => {
    dismissTimer = undefined;
    activeToast = null;
    notify();
  }, TOAST_DURATION_MS);
}

/** Dismisses the visible toast immediately. Safe to call when none is shown. */
export function dismissToast(): void {
  clearTimer();
  if (activeToast === null) return;
  activeToast = null;
  notify();
}

/** Reads the currently visible toast; reactive when read inside a tracking scope. */
export function currentToast(): ToastMessage | null {
  version();
  return activeToast;
}

export interface ToastViewportProps {
  /** Label for the dismiss button. */
  closeLabel?: string;
}

const VARIANT_ICON: Record<ToastVariant, IconName> = {
  success: 'check',
  error: 'warning',
  info: 'inbox',
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'alert-success',
  error: 'alert-error',
  info: 'alert-info',
};

export function ToastViewport(props: ToastViewportProps): JSX.Element {
  return (
    <Show when={currentToast()}>
      {(toast) => (
        <div class="toast toast-end toast-bottom z-50 max-sm:toast-center max-sm:w-full max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            class={[
              'alert alert-soft w-full sm:max-w-sm rounded-box border border-current/20 text-sm shadow-xl',
              VARIANT_CLASSES[toast().variant],
            ]}
          >
            <Icon name={VARIANT_ICON[toast().variant]} size={18} />
            <span class="flex-1 break-words">{toast().message}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={dismissToast}
            >
              {props.closeLabel ?? '关闭'}
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}
