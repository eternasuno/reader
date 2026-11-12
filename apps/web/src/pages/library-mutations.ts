import {
  type Article,
  LibraryError,
  libraryErrorMessage,
  type Preview,
} from '../lib/library';
import { removeItem, restoreItem, upsertItem } from './library-articles';
import type { LibraryStore } from './library-context';
import {
  removeFeed,
  restoreFeed,
  selectFeedByUrl,
  upsertFeed,
} from './library-feeds';
import { selectFeed, startLoad } from './library-loading';
import { writeRead } from './library-read';
import { loadCounts, loadFeeds } from './library-reference';
import { openSavedPageDuplicate } from './library-selection';

export type PreviewResult =
  | { readonly kind: 'preview'; readonly preview: Preview }
  | { readonly kind: 'failed' };

const reloadAfterRemoval = async (store: LibraryStore, id: string) => {
  const scope = store.state().scope;
  if (scope.kind === 'feeds' && scope.feedId === id) {
    await startLoad(store, { kind: 'feeds' }, store.state().unreadOnly);
  }
};

const isExistingFeed = (error: unknown): error is LibraryError =>
  error instanceof LibraryError && error.tag === 'FeedAlreadyExists';

const selectExistingFeed = async (
  store: LibraryStore,
  url: string
): Promise<void> => {
  let found = selectFeedByUrl(store.state().feeds, url);
  if (found === undefined) {
    await loadFeeds(store);
    found = selectFeedByUrl(store.state().feeds, url);
  }

  if (found !== undefined) {
    await selectFeed(store, found.id);
  }
};

export const toggleRead = async (
  store: LibraryStore,
  article: Article
): Promise<void> => {
  const current = store.lookup(article.id) ?? article;
  await writeRead(store, current, !current.read);
};

export const removeArticle = async (
  store: LibraryStore,
  article: Article
): Promise<boolean> => {
  const current = store.state();
  const index = current.items.findIndex((item) => item.id === article.id);
  const target = current.items[index] ?? article;
  const selected = current.selected;
  const token = store.begin(article.id);
  store.setState((value) => ({
    ...removeItem(value, target),
    selected: value.selected,
  }));
  try {
    await store.client.remove(article.id);
    if (store.end(article.id, token)) {
      store.setState((value) =>
        value.selected?.id === article.id
          ? { ...value, selected: undefined }
          : value
      );
    }

    await loadCounts(store);

    return true;
  } catch (error) {
    if (store.end(article.id, token)) {
      store.setState((value) => ({
        ...restoreItem(value, target, index),
        selected: value.selected ?? selected,
      }));
      store.notify('error', libraryErrorMessage(error));
    }

    return false;
  }
};

export const saveArticle = async (
  store: LibraryStore,
  article: Article
): Promise<boolean> => {
  const token = store.begin(article.id);
  try {
    const saved = await store.client.save(article);
    store.end(article.id, token);
    store.setState((current) => upsertItem(current, saved));
    await loadCounts(store);
    store.notify('success', '已保存到稍后阅读');

    return true;
  } catch (error) {
    store.end(article.id, token);
    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const addArticle = async (
  store: LibraryStore,
  url: string
): Promise<boolean> => {
  try {
    const item = await store.client.add(url);
    store.setState((current) => ({
      ...upsertItem(current, item),
      selected: item,
    }));
    await loadCounts(store);
    store.notify('success', '文章已添加');

    return true;
  } catch (error) {
    const outcome = await openSavedPageDuplicate(store, error, url);
    if (outcome.kind === 'opened') {
      return true;
    }

    store.notify(
      'error',
      libraryErrorMessage(
        outcome.kind === 'unavailable' ? outcome.error : error
      )
    );

    return false;
  }
};

export const previewUrl = async (
  store: LibraryStore,
  url: string
): Promise<PreviewResult> => {
  try {
    return { kind: 'preview', preview: await store.client.preview(url) };
  } catch (error) {
    store.notify('error', libraryErrorMessage(error));

    return { kind: 'failed' };
  }
};

export const subscribeFeed = async (
  store: LibraryStore,
  url: string,
  title: string,
  folderId?: string
): Promise<boolean> => {
  try {
    const feed =
      folderId === undefined
        ? await store.client.subscribe(url, title)
        : await store.client.subscribe(url, title, folderId);
    store.setState((current) => ({
      ...current,
      feeds: upsertFeed(current.feeds, feed),
    }));
    await loadCounts(store);
    store.notify('success', '订阅已添加');
    await selectFeed(store, feed.id);

    return true;
  } catch (error) {
    if (isExistingFeed(error) && error.url !== undefined) {
      store.notify('success', '该订阅已存在');
      await selectExistingFeed(store, error.url);

      return true;
    }

    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const unsubscribeFeed = async (
  store: LibraryStore,
  id: string
): Promise<boolean> => {
  const current = store.state();
  const feed = current.feeds.find((item) => item.id === id);
  const unread = current.counts.feeds[id] ?? 0;
  const token = store.begin(id);
  if (feed !== undefined) {
    store.setState((value) => removeFeed(value, feed, unread));
  }

  try {
    await store.client.unsubscribe(id);
    store.end(id, token);
    await loadCounts(store);
    await reloadAfterRemoval(store, id);

    return true;
  } catch (error) {
    if (store.end(id, token) && feed !== undefined) {
      store.setState((value) => restoreFeed(value, feed, unread));
    }

    store.notify('error', libraryErrorMessage(error));

    return false;
  }
};

export const extractArticle = async (
  store: LibraryStore,
  article: Article
): Promise<Article | undefined> => {
  const token = store.begin(article.id);
  try {
    const item = await store.client.extract(article);
    store.end(article.id, token);
    store.setState((current) => upsertItem(current, item));

    return item;
  } catch (error) {
    store.end(article.id, token);
    store.notify('error', libraryErrorMessage(error));

    return undefined;
  }
};
