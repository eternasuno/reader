import {
  FeedId,
  type FeedItem,
  FeedItemId,
  FolderId,
  SavedPageId,
} from '@reader/business';
import type { Runner } from '../client';
import type {
  Article,
  ArticlePage,
  ArticleRef,
  Counts,
  Feed,
  Folder,
  Scope,
} from '../types';
import {
  feedItemArticle,
  feedView,
  folderView,
  previewView,
  savedPageArticle,
} from '../views';
import { feedItemQuery, savedPageQuery } from './paging';

const articlePage = (
  items: ReadonlyArray<FeedItem>,
  cursor: string | null
): ArticlePage => ({
  items: items.map((item) => feedItemArticle(item)),
  cursor,
});

const listPage = async (
  run: Runner,
  scope: Scope,
  unreadOnly: boolean,
  cursor?: string
): Promise<ArticlePage> => {
  if (scope.kind === 'later') {
    const page = await run((client) =>
      client.library.savedPages({ query: savedPageQuery(unreadOnly, cursor) })
    );

    return {
      items: page.items.map((item) => savedPageArticle(item)),
      cursor: page.cursor,
    };
  }

  const query = feedItemQuery(unreadOnly, cursor);

  if (scope.kind === 'folder') {
    const folderId = FolderId.make(scope.folderId);
    const page = await run((client) =>
      client.library.feedItemsByFolder({ query: { folderId, ...query } })
    );

    return articlePage(page.items, page.cursor);
  }

  const { feedId } = scope;

  if (feedId === undefined) {
    const page = await run((client) => client.library.feedItems({ query }));

    return articlePage(page.items, page.cursor);
  }

  const page = await run((client) =>
    client.library.feedItemsByFeed({
      query: { feedId: FeedId.make(feedId), ...query },
    })
  );

  return articlePage(page.items, page.cursor);
};

const readFeeds = async (run: Runner): Promise<ReadonlyArray<Feed>> =>
  (await run((client) => client.library.feeds())).items.map((feed) =>
    feedView(feed)
  );

const readFolders = async (run: Runner): Promise<ReadonlyArray<Folder>> =>
  (await run((client) => client.library.folders())).items.map((folder) =>
    folderView(folder)
  );

const readArticle = async (
  run: Runner,
  ref: ArticleRef
): Promise<Article | null> => {
  if (ref.feedId === undefined) {
    const { item } = await run((client) =>
      client.library.savedPage({ query: { id: SavedPageId.make(ref.id) } })
    );

    return item === null ? null : savedPageArticle(item);
  }

  const { item } = await run((client) =>
    client.library.feedItem({ query: { id: FeedItemId.make(ref.id) } })
  );

  return item === null ? null : feedItemArticle(item);
};

const readSavedPageByUrl = async (
  run: Runner,
  url: string
): Promise<Article | null> => {
  const { item } = await run((client) =>
    client.library.savedPageByUrl({ query: { url } })
  );

  return item === null ? null : savedPageArticle(item);
};

const readPreview = async (run: Runner, url: string) =>
  previewView(
    (await run((client) => client.library.preview({ payload: { url } })))
      .preview
  );

const readUnreadCounts = async (run: Runner): Promise<Counts> => {
  const [feedUnread, savedUnread] = await Promise.all([
    run((client) => client.library.feedUnread()),
    run((client) => client.library.savedPageUnread()),
  ]);
  const feeds = feedUnread.feeds.map(
    (feed) => [feed.feedId, feed.count] as const
  );

  return {
    later: savedUnread.count,
    feeds: Object.fromEntries(feeds),
    feedsTotal: feeds.reduce((total, [, count]) => total + count, 0),
  };
};

export const readerMethods = (run: Runner) => ({
  list: (scope: Scope, unreadOnly: boolean, cursor?: string) =>
    listPage(run, scope, unreadOnly, cursor),
  feeds: () => readFeeds(run),
  folders: () => readFolders(run),
  unreadCounts: () => readUnreadCounts(run),
  article: (ref: ArticleRef) => readArticle(run, ref),
  findSavedPageByUrl: (url: string) => readSavedPageByUrl(run, url),
  preview: (url: string) => readPreview(run, url),
});
