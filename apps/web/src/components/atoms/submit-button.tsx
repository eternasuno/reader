import { Show } from 'solid-js';

type SubmitButtonProps = {
  pending: boolean;
  label: string;
  pendingLabel: string;
};

export const SubmitButton = (props: SubmitButtonProps) => (
  <button
    type="submit"
    class="btn"
    disabled={props.pending}
    aria-busy={props.pending ? 'true' : 'false'}
  >
    <Show when={props.pending}>
      <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    </Show>
    <span>{props.pending ? props.pendingLabel : props.label}</span>
  </button>
);
