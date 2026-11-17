import { createSignal } from 'solid-js';
import { ApiFailure } from '../api/failure';
import { messageOf } from '../api/messages';
import { addSavedPage, lookupSavedPage } from '../api/saved-page';
import { prependRow } from '../library';
import { showToast } from '../ui/toast';
import { reloadSavedPageCount } from './count';
import { savedPageMessages as copy } from './messages';

/** Opens a saved page in the reader, beside the `稍后阅读` list (later.md Interface). */
export type OpenSavedPage = (id: string) => void;

const [visible, setVisible] = createSignal(false);

/** Whether the add dialog is open; the library mounts it once. */
export const addLinkOpen = (): boolean => visible();

/** Opens the dialog; it starts with an empty field (later.md Interface). */
export const openAddLink = (): void => {
  setVisible(true);
};

export const closeAddLink = (): void => {
  setVisible(false);
};

/** The URL that `SavedPageAlreadyExists` carries (SP-ADD-1, SP-ID-4). */
const duplicateUrl = (failure: unknown): string | undefined =>
  failure instanceof ApiFailure && failure.tag === 'SavedPageAlreadyExists'
    ? failure.url
    : undefined;

/**
 * A page that is already saved is opened, not reported (SP-ID-4): the duplicate
 * error carries the normalized URL, and that page is looked up and opened as if
 * it had just been added. A lookup that finds nothing reports the duplicate and
 * a failed lookup its own failure; either way the dialog stays open with the
 * typed link (later.md Interface).
 */
const openExisting = async (
  url: string,
  duplicate: unknown,
  openPage: OpenSavedPage
): Promise<void> => {
  try {
    const { item } = await lookupSavedPage(url);

    if (item === null) {
      showToast(messageOf(duplicate), 'error');

      return;
    }

    setVisible(false);
    openPage(item.id);
  } catch (error) {
    showToast(messageOf(error), 'error');
  }
};

/** Reports a failure of adding, opening an existing page when it is a duplicate. */
const reportFailure = async (
  failure: unknown,
  openPage: OpenSavedPage
): Promise<void> => {
  const url = duplicateUrl(failure);

  if (url === undefined) {
    showToast(messageOf(failure), 'error');

    return;
  }

  await openExisting(url, failure, openPage);
};

/**
 * Adds the typed link (SP-ADD). On success the dialog closes, the toast
 * `文章已添加` appears, the page goes to the top of the shown `稍后阅读` list, the
 * count is read again and the new page opens in the reader; every failure keeps
 * the dialog open with the typed link and shows the toast of the error
 * (later.md Interface).
 */
export const addLink = async (
  url: string,
  openPage: OpenSavedPage
): Promise<void> => {
  try {
    const { item } = await addSavedPage(url);

    setVisible(false);
    showToast(copy.added);
    prependRow({ kind: 'later' }, { kind: 'saved-page', item });
    await reloadSavedPageCount();
    openPage(item.id);
  } catch (error) {
    await reportFailure(error, openPage);
  }
};
