import type { JSX } from '@solidjs/web';
import { t } from '../i18n';
import { Input } from '../ui';
import { DialogActions } from './DialogActions';

export interface SubscribeUrlFormProps {
  url: string;
  error?: string;
  busy: boolean;
  previewing: boolean;
  onUrl: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onCancel: () => void;
}

/** `FD-PREVIEW-1`: step one asks for the feed URL and previews it. */
export function SubscribeUrlForm(props: SubscribeUrlFormProps): JSX.Element {
  return (
    <form class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        type="url"
        required
        label={String(t('feeds.feedUrlLabel'))}
        placeholder={String(t('feeds.feedUrlPlaceholder'))}
        value={props.url}
        disabled={props.busy}
        error={props.error}
        onInput={(event) => props.onUrl(event.currentTarget.value)}
      />
      <DialogActions
        busy={props.busy}
        cancelLabel={String(t('common.cancel'))}
        submitLabel={String(
          t(props.previewing ? 'feeds.previewing' : 'feeds.previewSubmit')
        )}
        submitLoading={props.previewing}
        onCancel={props.onCancel}
      />
    </form>
  );
}
