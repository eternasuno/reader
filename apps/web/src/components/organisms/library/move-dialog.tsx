import { Option } from 'effect';
import { createEffect, createSignal, on } from 'solid-js';
import type { Feed, Folder } from '../../../api/library';
import { SubmitButton } from '../../atoms/submit-button';
import { Dialog } from '../../molecules/dialog';
import { FolderSelect } from './folder-select';

type MoveDialogProps = {
  readonly feed: Feed | undefined;
  readonly folders: ReadonlyArray<Folder>;
  readonly onClose: () => void;
  readonly onMove: (folderId: string | undefined) => Promise<boolean>;
};

const MoveForm = (props: MoveDialogProps) => {
  const [folderId, setFolderId] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  let openings = 0;
  createEffect(
    on(
      () => props.feed?.id,
      () => {
        const feed = props.feed;
        if (feed === undefined) return;

        openings += 1;
        setFolderId(Option.getOrUndefined(feed.folderId));
        setPending(false);
      }
    )
  );
  const submit = async () => {
    const opening = openings;
    setPending(true);
    try {
      const done = await props.onMove(folderId());
      if (done && opening === openings) props.onClose();
    } finally {
      if (opening === openings) setPending(false);
    }
  };

  return (
    <form
      class="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FolderSelect
        id="library-move-folder"
        folders={props.folders}
        value={folderId()}
        disabled={pending()}
        onChange={(value) => setFolderId(value)}
      />
      <div class="flex flex-wrap gap-2">
        <SubmitButton pending={pending()} label="移动" pendingLabel="移动中…" />
      </div>
    </form>
  );
};

export const LibraryMoveDialog = (props: MoveDialogProps) => (
  <Dialog
    open={props.feed !== undefined}
    label="移动到目录"
    onClose={props.onClose}
  >
    <section class="py-2" aria-labelledby="library-move-heading">
      <h2
        id="library-move-heading"
        class="text-lg font-semibold tracking-tight"
      >
        移动到目录
      </h2>
      <p class="mt-2 text-sm text-base-content/60">
        将「{props.feed?.title}」移动到：
      </p>
      <MoveForm
        feed={props.feed}
        folders={props.folders}
        onClose={props.onClose}
        onMove={props.onMove}
      />
    </section>
  </Dialog>
);
