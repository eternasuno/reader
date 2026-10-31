import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { SettingsToast as ToastState } from '../../pages/settings-model';
import { Button } from '../atoms/button';

export const SettingsToast = (props: {
  readonly toast: ToastState | undefined;
  readonly onDismiss: () => void;
}) => (
  <Show when={props.toast}>
    {(toast) => (
      <Portal>
        <div class="toast toast-end z-50">
          <div
            role={toast().kind === 'error' ? 'alert' : 'status'}
            class={`alert shadow-lg ${toast().kind === 'error' ? 'alert-error' : 'alert-success'}`}
          >
            <span class="text-sm">{toast().message}</span>
            <Button class="btn btn-sm" type="button" onClick={props.onDismiss}>
              关闭
            </Button>
          </div>
        </div>
      </Portal>
    )}
  </Show>
);
