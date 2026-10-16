import { Show } from 'solid-js';

export const FormError = (props: { message: string }) => (
  <Show when={props.message}>
    <p class="alert alert-error" role="alert">
      {props.message}
    </p>
  </Show>
);
