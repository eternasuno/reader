import { createSignal } from 'solid-js';
import { createFolder, renameFolder } from '../api/folder';
import { messageOf } from '../api/messages';
import { loadSidebar } from '../feed';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { FormField } from '../ui/form-field';
import { showToast } from '../ui/toast';
import type { Folder } from './list';

const createdMessage = '目录已创建';
const renamedMessage = '目录已重命名';

type DialogTarget = { readonly folder?: Folder | undefined };

const [target, setTarget] = createSignal<DialogTarget>();
const [name, setName] = createSignal('');
const [pending, setPending] = createSignal(false);

export const folderDialogOpen = (): boolean => target() !== undefined;
export const folderDialogFolder = (): Folder | undefined => target()?.folder;
export const folderDialogName = (): string => name();
export const folderDialogPending = (): boolean => pending();
export const setFolderDialogName = (next: string): void => {
  setName(next);
};

/** `新建目录`: the name is reset to empty on every open (folders.md). */
export const openCreateFolder = (): void => {
  setName('');
  setPending(false);
  setTarget({});
};

/** `重命名目录`: the name is reset to the current one on every open (folders.md). */
export const openRenameFolder = (folder: Folder): void => {
  setName(folder.name);
  setPending(false);
  setTarget({ folder });
};

export const closeFolderDialog = (): void => {
  setTarget(undefined);
};

const write = async (
  folder: Folder | undefined,
  value: string
): Promise<void> => {
  if (folder === undefined) {
    await createFolder(value);
    showToast(createdMessage);
  } else {
    await renameFolder(folder.id, value);
    showToast(renamedMessage);
  }

  setTarget(undefined);
  await loadSidebar();
};

/**
 * Sends the name as typed; the server trims it (FD-FOLDER-2). On success the
 * dialog closes and the sidebar lists the folders again, without reloading the
 * article list; on failure the wording is shown and the dialog keeps the name.
 */
export const submitFolderName = async (): Promise<void> => {
  const folder = folderDialogFolder();
  const value = name();

  setPending(true);

  try {
    await write(folder, value);
  } catch (error) {
    showToast(messageOf(error), 'error');
  } finally {
    setPending(false);
  }
};

const dialogTitle = (): string =>
  folderDialogFolder() === undefined ? '新建目录' : '重命名目录';

/** The shared folder dialog of `新建目录` and `重命名目录` (folders.md). */
export const FolderDialog = () => {
  const creating = () => folderDialogFolder() === undefined;

  return (
    <Dialog
      open={folderDialogOpen()}
      label={dialogTitle()}
      onClose={closeFolderDialog}
    >
      <section class="py-2">
        <h2 class="text-lg font-semibold tracking-tight">{dialogTitle()}</h2>
        <form
          class="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitFolderName();
          }}
        >
          <FormField
            id="folder-name"
            name="name"
            label="目录名称"
            hint="请输入目录名称"
            required
            autofocus
            disabled={folderDialogPending()}
            value={folderDialogName()}
            onInput={(event) => setFolderDialogName(event.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="solid"
            busy={folderDialogPending()}
            pendingLabel={creating() ? '创建中…' : '保存中…'}
          >
            {creating() ? '创建' : '保存'}
          </Button>
        </form>
      </section>
    </Dialog>
  );
};
