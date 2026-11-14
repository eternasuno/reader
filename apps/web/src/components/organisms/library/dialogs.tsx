import { createSignal } from 'solid-js';
import type { Article, Feed, Folder } from '../../../api/library';
import type { LibraryModel } from '../../../models/library/model';
import { LibraryAddDialog } from './add-dialog';
import { LibraryFolderDialog } from './folder-dialog';
import { LibraryMoveDialog } from './move-dialog';

type DialogRoute = {
  readonly open: (article: Article) => void;
  readonly back: () => void;
};

type FolderDialogState = { readonly folder?: Folder };

const addArticle = async (
  model: LibraryModel,
  route: DialogRoute,
  url: string
): Promise<boolean> => {
  if (!(await model.add(url))) return false;

  const added = model.state().selected;
  if (added === undefined) route.back();
  else route.open(added);

  return true;
};

const subscribeFeed = async (
  model: LibraryModel,
  route: DialogRoute,
  url: string,
  title: string,
  folderId: string | undefined
): Promise<boolean> => {
  if (!(await model.subscribe(url, title, folderId))) return false;

  route.back();

  return true;
};

const submitFolder = (
  model: LibraryModel,
  dialog: FolderDialogState | undefined,
  name: string
): Promise<boolean> => {
  const folder = dialog?.folder;

  return folder === undefined
    ? model.createFolder(name)
    : model.renameFolder(folder.id, name);
};

const moveToFolder = async (
  model: LibraryModel,
  feed: Feed | undefined,
  folderId: string | undefined
): Promise<boolean> => {
  if (feed === undefined) return false;

  return model.moveFeed(feed.id, folderId);
};

export const useLibraryDialogs = () => {
  const [addMode, setAddMode] = createSignal<'article' | 'feed'>();
  const [folderDialog, setFolderDialog] = createSignal<FolderDialogState>();
  const [movingFeed, setMovingFeed] = createSignal<Feed>();

  return {
    addMode,
    folderDialog,
    movingFeed,
    openAdd: (mode: 'article' | 'feed') => setAddMode(mode),
    closeAdd: () => setAddMode(undefined),
    createFolder: () => setFolderDialog({}),
    renameFolder: (folder: Folder) => setFolderDialog({ folder }),
    moveFeed: (feed: Feed) => setMovingFeed(feed),
    closeFolder: () => setFolderDialog(undefined),
    closeMove: () => setMovingFeed(undefined),
  };
};

type LibraryDialogsState = ReturnType<typeof useLibraryDialogs>;

type LibraryDialogsProps = {
  readonly model: LibraryModel;
  readonly route: DialogRoute;
  readonly dialogs: LibraryDialogsState;
};

export const LibraryDialogs = (props: LibraryDialogsProps) => (
  <>
    <LibraryAddDialog
      open={props.dialogs.addMode() !== undefined}
      mode={props.dialogs.addMode() ?? 'article'}
      folders={props.model.state().folders}
      onClose={props.dialogs.closeAdd}
      onAdd={(url) => addArticle(props.model, props.route, url)}
      onPreview={props.model.preview}
      onSubscribe={(url, title, folderId) =>
        subscribeFeed(props.model, props.route, url, title, folderId)
      }
    />
    <LibraryFolderDialog
      open={props.dialogs.folderDialog() !== undefined}
      folder={props.dialogs.folderDialog()?.folder}
      onClose={props.dialogs.closeFolder}
      onSubmit={(name) =>
        submitFolder(props.model, props.dialogs.folderDialog(), name)
      }
    />
    <LibraryMoveDialog
      feed={props.dialogs.movingFeed()}
      folders={props.model.state().folders}
      onClose={props.dialogs.closeMove}
      onMove={(folderId) =>
        moveToFolder(props.model, props.dialogs.movingFeed(), folderId)
      }
    />
  </>
);
