import type { JSX } from '@solidjs/web';
import { createEffect, onSettled } from 'solid-js';
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
  let inputEl: HTMLInputElement | undefined;

  onSettled(() => {
    queueMicrotask(() => inputEl?.focus());
  });

  createEffect(
    () => ({ error: props.error, busy: props.busy }),
    ({ error, busy }) => {
      if (error && !busy) queueMicrotask(() => inputEl?.focus());
    }
  );

  return (
    <form class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        ref={(el) => {
          inputEl = el;
        }}
        type="url"
        required
        label={t('feeds.feedUrlLabel')}
        placeholder={t('feeds.feedUrlPlaceholder')}
        value={props.url}
        disabled={props.busy}
        error={props.error}
        onInput={(event) => props.onUrl(event.currentTarget.value)}
      />
      <DialogActions
        busy={props.busy}
        cancelLabel={t('common.cancel')}
        submitLabel={t(
          props.previewing ? 'feeds.previewing' : 'feeds.previewSubmit'
        )}
        submitLoading={props.previewing}
        onCancel={props.onCancel}
      />
    </form>
  );
}
