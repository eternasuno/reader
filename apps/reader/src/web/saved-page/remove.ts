import { createSignal } from 'solid-js';
import { messageOf } from '../api/messages';
import { removeSavedPage as removePageRequest } from '../api/saved-page';
import { removeRow, type SavedPage } from '../library';
import { showToast } from '../ui/toast';
import { adjustSavedPageUnread, reloadSavedPageCount } from './count';

type Removal = {
  readonly page: SavedPage;
  readonly answer: (removed: boolean) => void;
};

const [question, setQuestion] = createSignal<Removal>();
let asking: Removal | undefined;

/** The page whose removal waits for the confirmation, while the dialog shows. */
export const pendingRemoval = (): SavedPage | undefined => question()?.page;

/**
 * Drops the row and an unread page's count at once, then sends the removal
 * (later.md Removing a saved page): success keeps the dropped row and reads the
 * count again, while a failure puts the row back at its place, reads a lowered
 * count again, shows the error toast and answers false.
 */
const removePage = async (page: SavedPage): Promise<boolean> => {
  const restore = removeRow(page.id);
  const lowered = !page.read;

  if (lowered) adjustSavedPageUnread(-1);

  try {
    await removePageRequest(page.id);
  } catch (error) {
    restore();
    if (lowered) await reloadSavedPageCount();

    showToast(messageOf(error), 'error');

    return false;
  }

  await reloadSavedPageCount();

  return true;
};

/** Takes the pending question, if there is one, and clears it. */
const takeQuestion = (): Removal | undefined => {
  const removal = asking;

  asking = undefined;
  setQuestion(undefined);

  return removal;
};

/**
 * Asks for the confirmation before removing a saved page and answers whether the
 * page was removed (later.md Removing a saved page): the row leaves the list at
 * once and an unread page's count drops by one, while a failed request puts the
 * row back, reads the count again, shows the error toast and answers false.
 * Cancelling changes nothing.
 */
export const removeSavedPage = (page: SavedPage): Promise<boolean> =>
  new Promise((answer) => {
    asking?.answer(false);

    const removal = { page, answer };

    asking = removal;
    setQuestion(removal);
  });

/** Confirms the pending removal and runs it. */
export const confirmRemoval = async (): Promise<void> => {
  const removal = takeQuestion();

  if (removal !== undefined) removal.answer(await removePage(removal.page));
};

/** Dismisses the pending removal; nothing changes (later.md Interface). */
export const cancelRemoval = (): void => {
  const removal = takeQuestion();

  if (removal !== undefined) removal.answer(false);
};
