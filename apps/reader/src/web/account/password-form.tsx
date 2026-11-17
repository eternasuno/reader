import { createSignal, type Setter } from 'solid-js';
import { changePassword } from '../api/auth';
import { messageOf } from '../api/messages';
import { Button } from '../ui/button';
import { FormField } from '../ui/form-field';
import { showToast } from '../ui/toast';
import {
  currentPasswordField,
  newPasswordConfirmationField,
  newPasswordField,
  newPasswordFieldName,
} from './fields';
import { accountMessages as copy } from './messages';
import { createPasswordDraft, type PasswordDraft } from './password-draft';

/** Applies the cross-field rule to the new-password field, then checks the form. */
const validDraft = (form: HTMLFormElement, draft: PasswordDraft): boolean => {
  const element = form.elements.namedItem(newPasswordFieldName);

  if (element instanceof HTMLInputElement) {
    element.setCustomValidity(
      draft.next() !== '' && draft.next() === draft.current()
        ? copy.newPasswordSameMessage
        : ''
    );
  }

  return form.checkValidity();
};

/** Sends the change, clears the fields and reports the outcome as a toast. */
const submitChange = async (
  draft: PasswordDraft,
  props: PasswordFormProps,
  setPending: Setter<boolean>
): Promise<void> => {
  setPending(true);
  props.onBusyChange?.(true);

  try {
    await changePassword({
      currentPassword: draft.current(),
      newPassword: draft.next(),
    });
    draft.clear();
    props.onDirtyChange?.(false);
    showToast(copy.passwordChanged);
  } catch (error) {
    showToast(messageOf(error), 'error');
  } finally {
    setPending(false);
    props.onBusyChange?.(false);
  }
};

export type PasswordFormProps = {
  /** The submit request: true when it starts and false when it settles. */
  readonly onBusyChange?: (busy: boolean) => void;
  /** Whether any of the three password fields holds text. */
  readonly onDirtyChange?: (dirty: boolean) => void;
};

type PasswordFieldsProps = {
  readonly draft: PasswordDraft;
  readonly pending: boolean;
  /** Tells the form that the fields changed, after the draft took the value. */
  readonly reportTyped: () => void;
};

/** The three fields, locked while the change runs (account.md Interface). */
const PasswordFields = (props: PasswordFieldsProps) => (
  <fieldset class="flex flex-col gap-4" disabled={props.pending}>
    <FormField
      {...currentPasswordField}
      value={props.draft.current()}
      onInput={(event) => {
        props.draft.setCurrent(event.currentTarget.value);
        props.reportTyped();
      }}
    />
    <FormField
      {...newPasswordField}
      value={props.draft.next()}
      hint={props.draft.newPasswordHint()}
      onInput={(event) => {
        props.draft.setNext(event.currentTarget.value);
        event.currentTarget.setCustomValidity('');
        props.reportTyped();
      }}
    />
    <FormField
      {...newPasswordConfirmationField}
      value={props.draft.confirmation()}
      hint={props.draft.confirmationHint()}
      pattern={props.draft.confirmationPattern()}
      onInput={(event) => {
        props.draft.setConfirmation(event.currentTarget.value);
        props.reportTyped();
      }}
    />
    <Button
      type="submit"
      variant="solid"
      class="btn btn-neutral self-start whitespace-nowrap"
      busy={props.pending}
      pendingLabel={copy.passwordSubmitPending}
    >
      {copy.passwordSubmit}
    </Button>
  </fieldset>
);

/**
 * The `账号` section of `/settings` (account.md Interface): the current password,
 * the new one and its confirmation. The form refuses a new password equal to the
 * current one and a differing confirmation before sending anything
 * (AC-PASSWORD-4), clears itself and shows the changed toast on success
 * (AC-PASSWORD-6), and reports a failure as an error toast while keeping what was
 * typed. Its pending state and its typed fields are reported through props, so
 * the settings task can own the section around it.
 */
export const PasswordForm = (props: PasswordFormProps) => {
  const draft = createPasswordDraft();
  const [pending, setPending] = createSignal(false);

  const reportTyped = (): void => {
    props.onDirtyChange?.(
      draft.current() !== '' ||
        draft.next() !== '' ||
        draft.confirmation() !== ''
    );
  };

  return (
    <form
      method="post"
      novalidate
      aria-busy={pending()}
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();

        const form = event.currentTarget;

        form.classList.add('submitted');

        if (!validDraft(form, draft) || pending()) return;

        void submitChange(draft, props, setPending);
      }}
    >
      <PasswordFields
        draft={draft}
        pending={pending()}
        reportTyped={reportTyped}
      />
    </form>
  );
};
