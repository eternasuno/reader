import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import type { FeedPreview, Folder } from '../api';
import { t } from '../i18n';
import { Select } from '../ui';
import { DialogActions } from './DialogActions';

const MAX_PREVIEW_TITLES = 3;

export interface SubscribePreviewFormProps {
  preview: FeedPreview;
  folders: ReadonlyArray<Folder>;
  folderId: string;
  error?: string;
  busy: boolean;
  submitting: boolean;
  onFolder: (value: string) => void;
  onBack: () => void;
  onSubmit: (event: SubmitEvent) => void;
}

/** `FD-SUB-1`: step two confirms the previewed feed and picks its folder. */
export function SubscribePreviewForm(
  props: SubscribePreviewFormProps
): JSX.Element {
  return (
    <form class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <PreviewSummary preview={props.preview} />
      <Select
        label={String(t('feeds.folderLabel'))}
        value={props.folderId}
        disabled={props.busy}
        onChange={(event) => props.onFolder(event.currentTarget.value)}
      >
        <option value="">{String(t('feeds.noFolder'))}</option>
        <For each={props.folders}>
          {(folder) => <option value={folder.id}>{folder.name}</option>}
        </For>
      </Select>
      <p class="text-xs break-words text-base-content/60">
        {props.preview.url}
      </p>
      <Show when={props.error}>
        {(message) => (
          <p class="text-xs text-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <DialogActions
        busy={props.busy}
        cancelLabel={String(t('feeds.backToEdit'))}
        submitLabel={String(
          t(props.submitting ? 'feeds.subscribing' : 'feeds.confirmSubscribe')
        )}
        submitLoading={props.submitting}
        onCancel={props.onBack}
      />
    </form>
  );
}

function PreviewSummary(props: { preview: FeedPreview }): JSX.Element {
  return (
    <div class="flex flex-col gap-1.5">
      <p class="text-sm font-medium break-words">{props.preview.title}</p>
      <Show when={props.preview.description}>
        {(description) => (
          <p class="text-xs break-words text-base-content/60">
            {description()}
          </p>
        )}
      </Show>
      <Show when={props.preview.titles.length > 0}>
        <ul class="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-base-content/80">
          <For each={props.preview.titles.slice(0, MAX_PREVIEW_TITLES)}>
            {(title) => <li class="break-words">{title}</li>}
          </For>
        </ul>
      </Show>
    </div>
  );
}
