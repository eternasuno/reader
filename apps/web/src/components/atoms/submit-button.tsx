import { Show } from 'solid-js';
import { Button } from './button';

type SubmitButtonProps = {
  pending: boolean;
  label: string;
  pendingLabel: string;
};

export const SubmitButton = (props: SubmitButtonProps) => (
  <Button
    type="submit"
    class="btn btn-neutral whitespace-nowrap"
    variant="solid"
    disabled={props.pending}
    aria-busy={props.pending ? 'true' : 'false'}
  >
    <Show when={props.pending}>
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    </Show>
    <span>{props.pending ? props.pendingLabel : props.label}</span>
  </Button>
);
