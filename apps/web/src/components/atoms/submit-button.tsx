import { Show } from 'solid-js';
import { Button } from './button';

type SubmitButtonProps = {
  pending: boolean;
  label: string;
  pendingLabel: string;
  type?: 'submit' | 'button';
  onClick?: () => void;
};

export const SubmitButton = (props: SubmitButtonProps) => (
  <Button
    type={props.type ?? 'submit'}
    class="btn btn-neutral whitespace-nowrap"
    variant="solid"
    disabled={props.pending}
    aria-busy={props.pending ? 'true' : 'false'}
    onClick={props.onClick}
  >
    <Show when={props.pending}>
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    </Show>
    <span>{props.pending ? props.pendingLabel : props.label}</span>
  </Button>
);
