import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { Feed, Folder } from '../api';
import { t } from '../i18n';
import { Dialog } from '../ui';
import { SubscribePreviewForm } from './SubscribePreviewForm';
import { SubscribeUrlForm } from './SubscribeUrlForm';
import { previewFeedUrl, subscribeToPreviewed } from './subscribeActions';
import { createSubscribeState } from './subscribeState';

export interface SubscribeFeedDialogProps {
  open: boolean;
  folders: ReadonlyArray<Folder>;
  existingFeeds: ReadonlyArray<Feed>;
  onClose: () => void;
  onSubscribed: (feed: Feed) => void;
  onDuplicateFound: (feed: Feed) => void;
}

/**
 * `FD-PREVIEW-1` / `FD-SUB-1`: two-step subscribe dialog. A duplicate
 * subscription (`409 FeedAlreadyExists`) closes the dialog, shows the info
 * toast, and opens the already subscribed feed.
 */
export function SubscribeFeedDialog(
  props: SubscribeFeedDialogProps
): JSX.Element {
  const state = createSubscribeState(props);

  const submitUrl = (event: SubmitEvent): void => {
    event.preventDefault();
    void previewFeedUrl(state);
  };

  const confirm = (event: SubmitEvent): void => {
    event.preventDefault();
    void subscribeToPreviewed(props, props.existingFeeds, state);
  };

  return (
    <Dialog
      open={props.open}
      title={String(t('feeds.subscribeTitle'))}
      busy={state.busy()}
      onClose={props.onClose}
    >
      <Show
        when={state.step() === 'preview' && state.preview()}
        fallback={
          <SubscribeUrlForm
            url={state.url()}
            error={state.error()}
            busy={state.busy()}
            previewing={state.previewing()}
            onUrl={state.setUrl}
            onSubmit={submitUrl}
            onCancel={props.onClose}
          />
        }
      >
        {(current) => (
          <SubscribePreviewForm
            preview={current()}
            folders={props.folders}
            folderId={state.folderId()}
            error={state.error()}
            busy={state.busy()}
            submitting={state.submitting()}
            onFolder={state.setFolderId}
            onBack={() => state.setStep('url')}
            onSubmit={confirm}
          />
        )}
      </Show>
    </Dialog>
  );
}
