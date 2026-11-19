import type { JSX } from '@solidjs/web';
import { Button } from '../ui';

export interface DialogActionsProps {
  /** Disables both buttons while a request is in flight. */
  busy: boolean;
  cancelLabel: string;
  submitLabel: string;
  onCancel: () => void;
  /** Defaults to `busy`. */
  submitLoading?: boolean;
}

/**
 * Shared cancel / confirm footer so every dialog form keeps the same ordering,
 * disabled state, and spinner affordance.
 */
export function DialogActions(props: DialogActionsProps): JSX.Element {
  return (
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onClick={props.onCancel} disabled={props.busy}>
        {props.cancelLabel}
      </Button>
      <Button
        type="submit"
        variant="primary"
        loading={props.submitLoading ?? props.busy}
        disabled={props.busy}
      >
        {props.submitLabel}
      </Button>
    </div>
  );
}
