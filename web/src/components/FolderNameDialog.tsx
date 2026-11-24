import type { JSX } from '@solidjs/web';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { type Folder, foldersApi } from '../api';
import { t } from '../i18n';
import { Dialog, Input, showToast } from '../ui';
import { createOpenReset } from './createOpenReset';
import { DialogActions } from './DialogActions';
import { errorText } from './errorText';

export interface FolderNameDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialName?: string;
  folderId?: string;
  onClose: () => void;
  onSaved: (folder?: Folder) => void;
}

interface FolderNameFormState {
  name: Accessor<string>;
  submitting: Accessor<boolean>;
  setError: Setter<string | undefined>;
  setSubmitting: Setter<boolean>;
}

/**
 * `folders.md`: create / rename folder share one name dialog.
 */
export function FolderNameDialog(props: FolderNameDialogProps): JSX.Element {
  const [name, setName] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const form: FolderNameFormState = {
    name,
    submitting,
    setError,
    setSubmitting,
  };

  createOpenReset(
    () => props.open,
    () => {
      setName(props.initialName ?? '');
      setSubmitting(false);
      setError(undefined);
    }
  );

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    void submitFolderName(props, form);
  };

  return (
    <Dialog
      open={props.open}
      title={dialogTitle(props.mode)}
      closeLabel={String(t('common.close'))}
      busy={submitting()}
      onClose={props.onClose}
    >
      <FolderNameForm
        name={name()}
        error={error()}
        busy={submitting()}
        onName={setName}
        onSubmit={submit}
        onCancel={props.onClose}
      />
    </Dialog>
  );
}

const dialogTitle = (mode: FolderNameDialogProps['mode']): string =>
  String(
    t(
      mode === 'create' ? 'folders.newFolderTitle' : 'folders.renameFolderTitle'
    )
  );

interface FolderNameFormProps {
  name: string;
  error?: string;
  busy: boolean;
  onName: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onCancel: () => void;
}

function FolderNameForm(props: FolderNameFormProps): JSX.Element {
  return (
    <form class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        type="text"
        required
        label={String(t('folders.folderNameLabel'))}
        placeholder={String(t('folders.folderNamePlaceholder'))}
        value={props.name}
        disabled={props.busy}
        error={props.error}
        onInput={(event) => props.onName(event.currentTarget.value)}
      />
      <DialogActions
        busy={props.busy}
        cancelLabel={String(t('common.cancel'))}
        submitLabel={String(
          t(props.busy ? 'folders.savingFolder' : 'folders.saveFolder')
        )}
        onCancel={props.onCancel}
      />
    </form>
  );
}

const submitFolderName = async (
  props: FolderNameDialogProps,
  form: FolderNameFormState
): Promise<void> => {
  if (form.submitting()) return;

  const trimmedName = form.name().trim();
  if (trimmedName.length === 0) {
    form.setError(String(t('errors.InvalidFolderName')));

    return;
  }

  if (props.mode === 'rename' && !props.folderId) {
    form.setError(String(t('errors.FolderNotFound')));

    return;
  }

  form.setSubmitting(true);
  form.setError(undefined);

  try {
    await persistFolder(props, trimmedName);
  } catch (err) {
    form.setError(errorText(err));
  } finally {
    form.setSubmitting(false);
  }
};

const persistFolder = async (
  props: FolderNameDialogProps,
  name: string
): Promise<void> => {
  if (props.mode === 'create') {
    const folder = await foldersApi.create(name);
    showToast(String(t('folders.createdToast')), 'success');
    props.onClose();
    props.onSaved(folder);

    return;
  }

  await foldersApi.rename(props.folderId ?? '', name);
  showToast(String(t('folders.renamedToast')), 'success');
  props.onClose();
  props.onSaved();
};
