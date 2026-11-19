import type { JSX } from '@solidjs/web';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { ApiError, type SavedPage, savedPagesApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { Dialog, showToast } from '../ui';
import { AddLinkForm } from './AddLinkForm';
import { createOpenReset } from './createOpenReset';
import { errorText } from './errorText';

export interface AddLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (page: SavedPage) => void;
  onDuplicateFound: (page: SavedPage) => void;
}

interface AddLinkFormState {
  url: Accessor<string>;
  submitting: Accessor<boolean>;
  setError: Setter<string | undefined>;
  setSubmitting: Setter<boolean>;
}

/**
 * `SP-ADD-1`: adding a link checks duplicates by normalized URL on the server.
 * A `409 SavedPageAlreadyExists` opens the existing page instead of erroring.
 */
export function AddLinkDialog(props: AddLinkDialogProps): JSX.Element {
  const [url, setUrl] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const form: AddLinkFormState = { url, submitting, setError, setSubmitting };

  createOpenReset(
    () => props.open,
    () => {
      setUrl('');
      setError(undefined);
      setSubmitting(false);
    }
  );

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    void submitAddLink(props, form);
  };

  return (
    <Dialog
      open={props.open}
      title={String(t('later.addLinkTitle'))}
      busy={submitting()}
      onClose={props.onClose}
    >
      <AddLinkForm
        url={url()}
        error={error()}
        busy={submitting()}
        onUrl={setUrl}
        onSubmit={submit}
        onCancel={props.onClose}
      />
    </Dialog>
  );
}

const submitAddLink = async (
  props: AddLinkDialogProps,
  form: AddLinkFormState
): Promise<void> => {
  if (form.submitting()) return;

  const target = form.url().trim();
  if (target.length === 0) return;

  form.setSubmitting(true);
  form.setError(undefined);

  try {
    const page = await savedPagesApi.create(target);
    showToast(String(t('later.addedToast')), 'success');
    props.onClose();
    props.onSaved(page);
  } catch (err) {
    await handleCreateFailure(props, form, err, target);
  } finally {
    form.setSubmitting(false);
  }
};

/** `409 SavedPageAlreadyExists` opens the stored page; anything else is inline. */
const handleCreateFailure = async (
  props: AddLinkDialogProps,
  form: AddLinkFormState,
  err: unknown,
  target: string
): Promise<void> => {
  if (!(err instanceof ApiError && err.code === 'SavedPageAlreadyExists')) {
    form.setError(errorText(err));
    return;
  }

  let existing: SavedPage | null = null;
  try {
    existing = await savedPagesApi.lookup(err.url ?? target);
  } catch {
    form.setError(translateErrorCode('RequestFailed'));
    return;
  }

  if (existing === null) {
    form.setError(translateErrorCode('SavedPageAlreadyExists'));
    return;
  }

  props.onClose();
  props.onDuplicateFound(existing);
};
