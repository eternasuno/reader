import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from './button';

export type ToastKind = 'success' | 'error';

export type Toast = {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
};

const toastDuration = 6000;

let nextToastId = 0;

const [toasts, setToasts] = createSignal<ReadonlyArray<Toast>>([]);

/** The toasts on screen, oldest first; `ToastContainer` renders them. */
export { toasts };

/** Removes one toast, by id; the container's dismiss button does this too. */
export const dismissToast = (id: number): void => {
  setToasts((current) => current.filter((toast) => toast.id !== id));
};

/**
 * Shows a toast and dismisses it after a moment. `ui/` owns the toast store per
 * the skill, so any module reports the outcome of an action with this call;
 * `messageOf(failure)` gives the wording of a failure (`reader-spec` Messages).
 */
export const showToast = (
  message: string,
  kind: ToastKind = 'success'
): void => {
  const id = nextToastId++;

  setToasts((current) => [...current, { id, message, kind }]);
  setTimeout(() => dismissToast(id), toastDuration);
};

/** Mounted once by the app root; renders the store in a portal. */
export const ToastContainer = () => (
  <Show when={toasts().length > 0}>
    <Portal>
      <div class="toast toast-end z-50">
        <For each={toasts()}>
          {(toast) => (
            <div
              role={toast.kind === 'error' ? 'alert' : 'status'}
              class={`alert shadow-lg ${toast.kind === 'error' ? 'alert-error' : 'alert-success'}`}
            >
              <span class="text-sm">{toast.message}</span>
              <Button
                class="btn btn-sm"
                type="button"
                onClick={() => dismissToast(toast.id)}
              >
                关闭
              </Button>
            </div>
          )}
        </For>
      </div>
    </Portal>
  </Show>
);
