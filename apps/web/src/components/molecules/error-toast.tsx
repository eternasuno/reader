import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon } from '../atoms/reader-icon';

const toastDuration = 8000;

export const ErrorToast = (props: {
  readonly message: string;
  readonly onRetry?: (() => void) | undefined;
  readonly onDismiss: () => void;
}) => (
  <Portal>
    <div class="toast toast-end z-50">
      <div role="alert" class="alert alert-error shadow-lg">
        <span class="text-sm">{props.message}</span>
        <div class="flex items-center gap-1">
          <Show when={props.onRetry}>
            {(retry) => (
              <Button
                class="btn btn-sm"
                type="button"
                onClick={() => retry()()}
              >
                重试
              </Button>
            )}
          </Show>
          <IconButton label="关闭错误提示" onClick={props.onDismiss}>
            <ReaderIcon name="close" />
          </IconButton>
        </div>
      </div>
    </div>
  </Portal>
);

export const useErrorToast = (
  error: () => string | undefined,
  active: () => boolean
) => {
  const [message, setMessage] = createSignal<string>();
  let shown: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => {
    if (timer === undefined) return;

    clearTimeout(timer);
    timer = undefined;
  };
  const dismiss = () => {
    clearTimer();
    setMessage(undefined);
  };
  createEffect(() => {
    const current = error();
    if (!active() || !current) {
      shown = undefined;
      dismiss();
      return;
    }

    if (shown === current) return;

    shown = current;
    clearTimer();
    setMessage(current);
    timer = setTimeout(() => {
      timer = undefined;
      setMessage(undefined);
    }, toastDuration);
  });
  onCleanup(clearTimer);

  return { message, dismiss };
};
