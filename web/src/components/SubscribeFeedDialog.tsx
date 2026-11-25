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

function SubscribeDialogBody(props: {
  dialogProps: SubscribeFeedDialogProps;
  state: ReturnType<typeof createSubscribeState>;
}): JSX.Element {
  const submitUrl = (event: SubmitEvent): void => {
    event.preventDefault();
    void previewFeedUrl(props.state);
  };

  const confirm = (event: SubmitEvent): void => {
    event.preventDefault();
    void subscribeToPreviewed(props.dialogProps, props.state);
  };

  return (
    <Show
      when={props.state.preview()}
      fallback={
        <SubscribeUrlForm
          url={props.state.url()}
          error={props.state.error()}
          busy={props.state.busy()}
          previewing={props.state.previewing()}
          onUrl={props.state.setUrl}
          onSubmit={submitUrl}
          onCancel={props.dialogProps.onClose}
        />
      }
    >
      {(current) => (
        <SubscribePreviewForm
          preview={current()}
          folders={props.dialogProps.folders}
          folderId={props.state.folderId()}
          error={props.state.error()}
          busy={props.state.busy()}
          submitting={props.state.submitting()}
          onFolder={props.state.setFolderId}
          onBack={() => {
            props.state.setPreview(null);
            props.state.setError(undefined);
          }}
          onSubmit={confirm}
        />
      )}
    </Show>
  );
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

  return (
    <Dialog
      open={props.open}
      title={t('feeds.subscribeTitle')}
      closeLabel={t('common.close')}
      busy={state.busy()}
      onClose={props.onClose}
    >
      <SubscribeDialogBody dialogProps={props} state={state} />
    </Dialog>
  );
}
