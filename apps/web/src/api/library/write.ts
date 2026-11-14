import { FeedId, FeedItemId, FolderId, SavedPageId } from '@reader/business';
import type { Runner } from '../client';
import type { Article, ArticleRef } from '../types';
import {
  feedItemArticle,
  feedView,
  folderView,
  savedPageArticle,
} from '../views';

const markArticle = async (
  run: Runner,
  ref: ArticleRef,
  read: boolean
): Promise<void> => {
  if (ref.feedId === undefined) {
    await run((client) =>
      client.library.markSavedPage({
        payload: { id: SavedPageId.make(ref.id), read },
      })
    );

    return;
  }

  await run((client) =>
    client.library.markFeedItem({
      payload: { id: FeedItemId.make(ref.id), read },
    })
  );
};

const idsOf = (
  refs: ReadonlyArray<ArticleRef>,
  saved: boolean
): ReadonlyArray<string> =>
  refs
    .filter((ref) => (ref.feedId === undefined) === saved)
    .map((ref) => ref.id);

const markArticleIds = async (
  run: Runner,
  refs: ReadonlyArray<ArticleRef>
): Promise<void> => {
  const savedIds = idsOf(refs, true);

  if (savedIds.length > 0) {
    await run((client) =>
      client.library.markSavedPages({
        payload: { ids: savedIds.map((id) => SavedPageId.make(id)) },
      })
    );
  }

  const feedIds = idsOf(refs, false);

  if (feedIds.length > 0) {
    await run((client) =>
      client.library.markFeedItems({
        payload: { ids: feedIds.map((id) => FeedItemId.make(id)) },
      })
    );
  }
};

const addArticle = async (run: Runner, url: string): Promise<Article> =>
  savedPageArticle(
    (await run((client) => client.library.addSavedPage({ payload: { url } })))
      .item
  );

const saveArticle = async (run: Runner, article: Article): Promise<Article> => {
  const { item } = await run((client) =>
    client.library.saveFeedItem({
      payload: { id: FeedItemId.make(article.id) },
    })
  );

  return savedPageArticle(item);
};

const extractArticle = async (
  run: Runner,
  article: Article
): Promise<Article> => {
  const { item } = await run((client) =>
    client.library.extractFeedItem({
      payload: { id: FeedItemId.make(article.id) },
    })
  );

  return feedItemArticle(item);
};

export const articleMethods = (run: Runner) => ({
  markRead: (ref: ArticleRef, read: boolean) => markArticle(run, ref, read),
  markLater: async () => {
    await run((client) => client.library.markAllSavedPages({ payload: {} }));
  },
  markAllFeeds: async () => {
    await run((client) => client.library.markAllFeedItems({ payload: {} }));
  },
  markFeeds: async (feedIds: ReadonlyArray<string>) => {
    await run((client) =>
      client.library.markFeedsRead({
        payload: { feedIds: feedIds.map((id) => FeedId.make(id)) },
      })
    );
  },
  markArticles: (refs: ReadonlyArray<ArticleRef>) => markArticleIds(run, refs),
  remove: async (id: string) => {
    await run((client) =>
      client.library.removeSavedPage({ payload: { id: SavedPageId.make(id) } })
    );
  },
  save: (article: Article) => saveArticle(run, article),
  add: (url: string) => addArticle(run, url),
  extract: (article: Article) => extractArticle(run, article),
});

export const folderMethods = (run: Runner) => ({
  createFolder: async (name: string) =>
    folderView(
      (
        await run((client) =>
          client.library.createFolder({ payload: { name } })
        )
      ).item
    ),
  renameFolder: async (id: string, name: string) => {
    await run((client) =>
      client.library.renameFolder({ payload: { id: FolderId.make(id), name } })
    );
  },
  removeFolder: async (id: string) => {
    await run((client) =>
      client.library.removeFolder({ payload: { id: FolderId.make(id) } })
    );
  },
  moveFeed: async (feedId: string, folderId: string | undefined) => {
    await run((client) =>
      client.library.moveFeed({
        payload: {
          id: FeedId.make(feedId),
          folderId: folderId === undefined ? null : FolderId.make(folderId),
        },
      })
    );
  },
  markFolders: async (folderIds: ReadonlyArray<string>) => {
    await run((client) =>
      client.library.markFoldersRead({
        payload: { folderIds: folderIds.map((id) => FolderId.make(id)) },
      })
    );
  },
});

export const feedMethods = (run: Runner) => ({
  subscribe: async (url: string, title: string, folderId?: string) =>
    feedView(
      (
        await run((client) =>
          client.library.subscribe({
            payload: {
              url,
              title,
              ...(folderId === undefined
                ? {}
                : { folderId: FolderId.make(folderId) }),
            },
          })
        )
      ).item
    ),
  unsubscribe: async (id: string) => {
    await run((client) =>
      client.library.unsubscribe({ payload: { id: FeedId.make(id) } })
    );
  },
});
