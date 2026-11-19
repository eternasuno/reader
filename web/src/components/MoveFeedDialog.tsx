import type { JSX } from '@solidjs/web';
import { type Accessor, createSignal, For, type Setter, Show } from 'solid-js';
import type { Feed, Folder } from '../api';
import { t } from '../i18n';
import { Dialog, Select } from '../ui';
import { createOpenReset } from './createOpenReset';
import { errorText } from './errorText';

export interface MoveFeedDialogProps {
  open: boolean;
  feed: Feed | null;
  folders: ReadonlyArray<Folder>;
  onClose: () => void;
  onMove: (feed: Feed, targetFolderId: string | null) => Promise<void> | void;
}

interface MoveFeedState {
  setFolderId: Setter<string>;
  moving: Accessor<boolean>;
  setMoving: Setter<boolean>;
  setError: Setter<string | undefined>;
}

/**
 * `FD-MOVE-1`: move a feed into a folder (or back to the top level).
 */
export function MoveFeedDialog(props: MoveFeedDialogProps): JSX.Element {
  const [folderId, setFolderId] = createSignal('');
  const [moving, setMoving] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const state: MoveFeedState = { setFolderId, moving, setMoving, setError };

  createOpenReset(
    () => props.open,
    () => {
      setFolderId(props.feed?.folderId ?? '');
      setMoving(false);
      setError(undefined);
    }
  );

  const move = (targetFolderId: string): void => {
    void moveFeed(props, state, targetFolderId);
  };

  return (
    <Dialog
      open={props.open}
      title={String(t('folders.moveTitle'))}
      busy={moving()}
      onClose={props.onClose}
    >
      <MoveFeedBody
        feed={props.feed}
        folders={props.folders}
        folderId={folderId()}
        error={error()}
        busy={moving()}
        onFolder={move}
      />
    </Dialog>
  );
}

interface MoveFeedBodyProps {
  feed: Feed | null;
  folders: ReadonlyArray<Folder>;
  folderId: string;
  error?: string;
  busy: boolean;
  onFolder: (folderId: string) => void;
}

function MoveFeedBody(props: MoveFeedBodyProps): JSX.Element {
  return (
    <div class="flex flex-col gap-4">
      <Show when={props.feed}>
        {(feed) => (
          <p class="text-sm break-words text-base-content/70">{feed().title}</p>
        )}
      </Show>
      <Select
        label={String(t('feeds.folderLabel'))}
        value={props.folderId}
        disabled={props.busy || props.feed === null}
        onChange={(event) => props.onFolder(event.currentTarget.value)}
      >
        <option value="">{String(t('feeds.noFolder'))}</option>
        <For each={props.folders}>
          {(folder) => <option value={folder.id}>{folder.name}</option>}
        </For>
      </Select>
      <Show when={props.error}>
        {(message) => (
          <p class="text-xs text-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

const moveFeed = async (
  props: MoveFeedDialogProps,
  state: MoveFeedState,
  targetFolderId: string
): Promise<void> => {
  const feed = props.feed;
  if (!feed || state.moving()) return;

  state.setFolderId(targetFolderId);
  state.setMoving(true);
  state.setError(undefined);

  try {
    await props.onMove(feed, targetFolderId === '' ? null : targetFolderId);
    props.onClose();
  } catch (err) {
    state.setError(errorText(err));
  } finally {
    state.setMoving(false);
  }
};
