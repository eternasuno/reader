import { type JSX, Show } from 'solid-js';
import { Button } from '../ui/button';

export type AuthFormProps = {
  /** A request is in flight: the fields and the submit are disabled. */
  readonly busy: boolean;
  /** The wording of the last failure, as an alert inside the form. */
  readonly failure: string;
  readonly submitLabel: string;
  readonly submitPendingLabel: string;
  /** Called with the form once it passes native validation and is not busy. */
  readonly onSubmit: (form: HTMLFormElement) => void;
  readonly children: JSX.Element;
};

/**
 * The form chrome of the auth pages: native validation with the `submitted`
 * class that reveals the field messages, the failure alert, and the submit
 * button with its pending label. What the values become and where success goes
 * is the page's (account.md Interface).
 */
export const AuthForm = (props: AuthFormProps) => (
  <form
    method="post"
    novalidate
    aria-busy={props.busy}
    class="flex flex-col gap-4"
    onSubmit={(event) => {
      event.preventDefault();

      const form = event.currentTarget;

      form.classList.add('submitted');

      if (!form.checkValidity() || props.busy) return;

      props.onSubmit(form);
    }}
  >
    <fieldset class="flex flex-col gap-4" disabled={props.busy}>
      {props.children}
      <Show when={props.failure}>
        <p role="alert" class="alert alert-error">
          {props.failure}
        </p>
      </Show>
      <Button
        type="submit"
        variant="solid"
        class="btn btn-neutral whitespace-nowrap"
        busy={props.busy}
        pendingLabel={props.submitPendingLabel}
      >
        {props.submitLabel}
      </Button>
    </fieldset>
  </form>
);
