import { createSignal } from 'solid-js';
import { ApiFailure } from '../api/failure';
import { type FeedPreview, previewFeed, subscribeFeed } from '../api/feed';
import { messageOf } from '../api/messages';
import { expandFolder } from '../folder';
import { selectScope } from '../library';
import { showToast } from '../ui/toast';
import { type Feed, feedByUrl, loadFeeds } from './list';
import { loadSidebar } from './sidebar';

export type { FeedPreview } from '../api/feed';

const subscribedMessage = '订阅已添加';
const existingMessage = '该订阅已存在';

const [open, setOpen] = createSignal(false);
const [preview, setPreview] = createSignal<FeedPreview>();
const [chosenFolder, setChosenFolder] = createSignal<string>();
const [pending, setPending] = createSignal<'preview' | 'subscribe'>();

export const subscribeOpen = (): boolean => open();
export const subscribePreview = (): FeedPreview | undefined => preview();
export const subscribeFolder = (): string | undefined => chosenFolder();
export const subscribePending = (): 'preview' | 'subscribe' | undefined =>
  pending();

export const setSubscribeFolder = (folderId: string | undefined): void => {
  setChosenFolder(folderId);
};

/** Every open resets the address, the preview and the folder choice (feeds.md). */
export const openSubscribe = (): void => {
  setPreview(undefined);
  setChosenFolder(undefined);
  setPending(undefined);
  setOpen(true);
};

export const closeSubscribe = (): void => {
  setOpen(false);
  setPending(undefined);
};

/** `返回修改`: drops the preview and shows the address form with its address. */
export const returnToEdit = (): void => setPreview(undefined);

/**
 * Previews the address without storing anything (FD-PREVIEW-1). A failure is
 * toasted and keeps the dialog, the address and the form (FD-PREVIEW-2).
 */
export const previewAddress = async (address: string): Promise<void> => {
  setPending('preview');

  try {
    setPreview((await previewFeed(address)).preview);
  } catch (error) {
    showToast(messageOf(error), 'error');
  } finally {
    setPending(undefined);
  }
};

/** The feed the owner follows at an address, reloading the list once to look it up. */
const feedAt = async (url: string): Promise<Feed | undefined> => {
  const loaded = feedByUrl(url);

  if (loaded !== undefined) return loaded;

  try {
    await loadFeeds();
  } catch {
    return undefined;
  }

  return feedByUrl(url);
};

const isExistingFeed = (
  error: unknown
): error is ApiFailure & { readonly url: string } =>
  error instanceof ApiFailure &&
  error.tag === 'FeedAlreadyExists' &&
  error.url !== undefined;

const openFeed = (feed: Feed): void => {
  selectScope({ kind: 'feed', id: feed.id });
};

/** The address is already followed: closes the dialog and opens that feed (FD-SUB-7). */
const openExistingFeed = async (url: string): Promise<void> => {
  setOpen(false);

  const existing = await feedAt(url);

  if (existing !== undefined) openFeed(existing);
};

const subscribe = async (
  subscription: FeedPreview,
  folderId: string | undefined
): Promise<void> => {
  const { item } = await subscribeFeed({
    url: subscription.url,
    title: subscription.title,
    folderId,
  });

  setOpen(false);

  if (folderId !== undefined) expandFolder(folderId);

  showToast(subscribedMessage, 'success');
  await loadSidebar();
  openFeed(item);
};

const failSubscription = async (error: unknown): Promise<void> => {
  if (isExistingFeed(error)) {
    showToast(existingMessage, 'success');
    await openExistingFeed(error.url);

    return;
  }

  showToast(messageOf(error), 'error');
};

/**
 * Subscribes with the previewed address and title and the chosen folder
 * (FD-SUB-6): on success the dialog closes, the new feed is listed and selected.
 * Any other failure keeps the dialog and the preview and leaves the scope alone.
 */
export const confirmSubscription = async (): Promise<void> => {
  const subscription = preview();

  if (subscription === undefined) return;

  const folderId = chosenFolder();

  setPending('subscribe');

  try {
    await subscribe(subscription, folderId);
  } catch (error) {
    await failSubscription(error);
  } finally {
    setPending(undefined);
  }
};
