import type { JSX } from '@solidjs/web';
import { t } from '../i18n';
import { Input } from '../ui';
import { DialogActions } from './DialogActions';

export interface AddLinkFormProps {
  url: string;
  error?: string;
  busy: boolean;
  onUrl: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onCancel: () => void;
}

/** `SP-ADD-1`: the single URL field plus cancel / add actions. */
export function AddLinkForm(props: AddLinkFormProps): JSX.Element {
  return (
    <form class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        type="url"
        required
        label={t('later.urlLabel')}
        placeholder={t('later.urlPlaceholder')}
        value={props.url}
        disabled={props.busy}
        error={props.error}
        onInput={(event) => props.onUrl(event.currentTarget.value)}
      />
      <DialogActions
        busy={props.busy}
        cancelLabel={t('common.cancel')}
        submitLabel={t(props.busy ? 'later.adding' : 'later.addSubmit')}
        onCancel={props.onCancel}
      />
    </form>
  );
}
