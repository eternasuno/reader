import { createEffect, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { LibraryToast } from '../../pages/library-model';
import { Button } from '../atoms/button';

const toastDuration = 6000;

export const LibraryToastView = (props: {
  readonly toast: LibraryToast | undefined;
  readonly onDismiss: () => void;
}) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer === undefined) return;

    clearTimeout(timer);
    timer = undefined;
  };
  createEffect(() => {
    const current = props.toast;
    clear();
    if (current === undefined) return;

    timer = setTimeout(() => {
      timer = undefined;
      props.onDismiss();
    }, toastDuration);
  });
  onCleanup(clear);

  return (
    <Show when={props.toast}>
      {(toast) => (
        <Portal>
          <div class="toast toast-end z-50">
            <div
              role={toast().kind === 'error' ? 'alert' : 'status'}
              class={`alert shadow-lg ${toast().kind === 'error' ? 'alert-error' : 'alert-success'}`}
            >
              <span class="text-sm">{toast().message}</span>
              <Button
                class="btn btn-sm"
                type="button"
                onClick={props.onDismiss}
              >
                关闭
              </Button>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
};
