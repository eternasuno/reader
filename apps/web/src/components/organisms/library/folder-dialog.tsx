import { createEffect, createSignal, on } from 'solid-js';
import type { Folder } from '../../../api/library';
import { SubmitButton } from '../../atoms/submit-button';
import { Dialog } from '../../molecules/dialog';
import { FormInput } from '../../molecules/form-input';

type FolderDialogProps = {
  readonly open: boolean;
  readonly folder: Folder | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => Promise<boolean>;
};

const useFolderForm = (props: FolderDialogProps) => {
  const [name, setName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  let openings = 0;
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;

        openings += 1;
        setName(props.folder?.name ?? '');
        setPending(false);
      }
    )
  );
  const submit = async () => {
    const opening = openings;
    setPending(true);
    try {
      const done = await props.onSubmit(name());
      if (done && opening === openings) props.onClose();
    } finally {
      if (opening === openings) setPending(false);
    }
  };

  return { name, setName, pending, submit };
};

const FolderForm = (props: FolderDialogProps) => {
  const { name, setName, pending, submit } = useFolderForm(props);
  const creating = () => props.folder === undefined;

  return (
    <form
      class="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormInput
        id="library-folder-name"
        name="name"
        label="目录名称"
        hint="请输入目录名称"
        required
        autofocus
        disabled={pending()}
        value={name()}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <div class="flex flex-wrap gap-2">
        <SubmitButton
          pending={pending()}
          label={creating() ? '创建' : '保存'}
          pendingLabel={creating() ? '创建中…' : '保存中…'}
        />
      </div>
    </form>
  );
};

export const LibraryFolderDialog = (props: FolderDialogProps) => {
  const title = () => (props.folder === undefined ? '新建目录' : '重命名目录');

  return (
    <Dialog open={props.open} label={title()} onClose={props.onClose}>
      <section class="py-2" aria-labelledby="library-folder-heading">
        <h2
          id="library-folder-heading"
          class="text-lg font-semibold tracking-tight"
        >
          {title()}
        </h2>
        <FolderForm
          open={props.open}
          folder={props.folder}
          onClose={props.onClose}
          onSubmit={props.onSubmit}
        />
      </section>
    </Dialog>
  );
};
