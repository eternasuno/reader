import { Option } from 'effect';
import type { Feed, FeedItem, Preview, SavedPage } from './library-schema';
import {
  FeedItemOrNullResponseSchema,
  FeedItemPageSchema,
  FeedItemResponseSchema,
  FeedResponseSchema,
  FeedsResponseSchema,
  FeedUnreadSchema,
  PreviewResponseSchema,
  SavedPageOrNullResponseSchema,
  SavedPagePageSchema,
  SavedPageResponseSchema,
  SavedPageUnreadSchema,
} from './library-schema';
import { decodeBody, type Send, sendGet, sendJson } from './library-transport';
import type {
  Article,
  ArticlePage,
  ArticleRef,
  Counts,
  Scope,
} from './library-types';

const PAGE_SIZE = 30;

const savedPagesPath = '/api/library/saved-pages';

const feedItemsPath = '/api/library/feeds/items';

const savedPageArticle = (page: SavedPage): Article => ({
  id: page.id,
  feedId: Option.none(),
  url: Option.some(page.url),
  title: page.title,
  description: page.description,
  content: Option.some(page.content),
  extractedContent: Option.some(page.content),
  publishedAt: Option.getOrUndefined(page.publishedAt),
  read: page.read,
});

const feedItemArticle = (item: FeedItem): Article => ({
  id: item.id,
  feedId: Option.some(item.feedId),
  url: Option.some(item.url),
  title: item.title,
  description: item.description,
  content: item.content,
  extractedContent: item.extractedContent,
  publishedAt: Option.getOrUndefined(item.publishedAt),
  read: item.read,
});

export const refOf = (article: Article): ArticleRef => ({
  id: article.id,
  feedId: Option.getOrUndefined(article.feedId),
});

const listQuery = (
  scope: Scope,
  unreadOnly: boolean,
  cursor: string | undefined
): Readonly<Record<string, string | undefined>> => {
  const feedId = scope.kind === 'feeds' ? scope.feedId : undefined;

  return {
    unreadOnly: String(unreadOnly),
    limit: String(PAGE_SIZE),
    cursor,
    feedId,
  };
};

export const readPage = async (
  send: Send,
  scope: Scope,
  unreadOnly: boolean,
  cursor?: string
): Promise<ArticlePage> => {
  const query = listQuery(scope, unreadOnly, cursor);

  if (scope.kind === 'later') {
    const page = await decodeBody(
      SavedPagePageSchema,
      await sendGet(send, savedPagesPath, query)
    );

    return { ...page, items: page.items.map(savedPageArticle) };
  }

  const page = await decodeBody(
    FeedItemPageSchema,
    await sendGet(send, feedItemsPath, query)
  );

  return { ...page, items: page.items.map(feedItemArticle) };
};

export const readFeeds = async (send: Send): Promise<ReadonlyArray<Feed>> =>
  (
    await decodeBody(
      FeedsResponseSchema,
      await sendGet(send, '/api/library/feeds')
    )
  ).items;

export const readUnreadCounts = async (send: Send): Promise<Counts> => {
  const [feedBody, savedBody] = await Promise.all([
    sendGet(send, '/api/library/feeds/unread'),
    sendGet(send, `${savedPagesPath}/unread`),
  ]);
  const { feeds } = await decodeBody(FeedUnreadSchema, feedBody);
  const saved = await decodeBody(SavedPageUnreadSchema, savedBody);

  return {
    later: saved.count,
    feedsTotal: feeds.reduce((total, feed) => total + feed.count, 0),
    feeds: Object.fromEntries(feeds.map((feed) => [feed.feedId, feed.count])),
  };
};

export const readArticle = async (
  send: Send,
  ref: ArticleRef
): Promise<Article | null> => {
  if (ref.feedId === undefined) {
    const { item } = await decodeBody(
      SavedPageOrNullResponseSchema,
      await sendGet(send, `${savedPagesPath}/item`, { id: ref.id })
    );

    return item === null ? null : savedPageArticle(item);
  }

  const { item } = await decodeBody(
    FeedItemOrNullResponseSchema,
    await sendGet(send, `${feedItemsPath}/item`, { id: ref.id })
  );

  return item === null ? null : feedItemArticle(item);
};

export const readSavedPageByUrl = async (
  send: Send,
  url: string
): Promise<Article | null> => {
  const { item } = await decodeBody(
    SavedPageOrNullResponseSchema,
    await sendGet(send, `${savedPagesPath}/by-url`, { url })
  );

  return item === null ? null : savedPageArticle(item);
};

const readSavedPage = async (
  send: Send,
  path: string,
  body: unknown
): Promise<Article> =>
  savedPageArticle(
    (
      await decodeBody(
        SavedPageResponseSchema,
        await sendJson(send, path, body)
      )
    ).item
  );

const readFeedItem = async (
  send: Send,
  path: string,
  body: unknown
): Promise<Article> =>
  feedItemArticle(
    (await decodeBody(FeedItemResponseSchema, await sendJson(send, path, body)))
      .item
  );

export const addSavedPage = (send: Send, url: string): Promise<Article> =>
  readSavedPage(send, savedPagesPath, { url });

export const saveFeedItem = (send: Send, article: Article): Promise<Article> =>
  Option.isNone(article.feedId)
    ? Promise.resolve(article)
    : readSavedPage(send, `${savedPagesPath}/from-feed-item`, {
        id: article.id,
      });

export const extractFeedItem = (
  send: Send,
  article: Article
): Promise<Article> =>
  Option.isNone(article.feedId)
    ? Promise.resolve(article)
    : readFeedItem(send, `${feedItemsPath}/extract`, { id: article.id });

export const readPreview = async (send: Send, url: string): Promise<Preview> =>
  (
    await decodeBody(
      PreviewResponseSchema,
      await sendJson(send, '/api/library/feeds/preview', { url })
    )
  ).preview;

export const readSubscription = async (
  send: Send,
  url: string,
  title: string
): Promise<Feed> =>
  (
    await decodeBody(
      FeedResponseSchema,
      await sendJson(send, '/api/library/feeds', { url, title })
    )
  ).item;

export const markRead = async (send: Send, ref: ArticleRef, read: boolean) => {
  const path = ref.feedId === undefined ? savedPagesPath : feedItemsPath;

  await send(path, { method: 'PATCH', body: { id: ref.id, read } });
};

export const markLater = async (send: Send) => {
  await sendJson(send, `${savedPagesPath}/mark-all-read`, {});
};

export const markAllFeeds = async (send: Send) => {
  await sendJson(send, '/api/library/feeds/mark-all-read', {});
};

export const markFeeds = async (send: Send, feedIds: ReadonlyArray<string>) => {
  await sendJson(send, '/api/library/feeds/mark-read', { feedIds });
};

const idsOf = (
  refs: ReadonlyArray<ArticleRef>,
  kind: 'saved' | 'feed'
): ReadonlyArray<string> =>
  refs
    .filter((ref) => (ref.feedId === undefined) === (kind === 'saved'))
    .map((ref) => ref.id);

const postIds = async (
  send: Send,
  path: string,
  ids: ReadonlyArray<string>
) => {
  if (ids.length > 0) {
    await sendJson(send, path, { ids });
  }
};

export const markArticles = async (
  send: Send,
  refs: ReadonlyArray<ArticleRef>
) => {
  await postIds(send, `${savedPagesPath}/mark-read`, idsOf(refs, 'saved'));
  await postIds(send, `${feedItemsPath}/mark-read`, idsOf(refs, 'feed'));
};

export const removeSavedPage = async (send: Send, id: string) => {
  await send(savedPagesPath, { method: 'DELETE', body: { id } });
};

export const removeSubscription = async (send: Send, id: string) => {
  await send('/api/library/feeds', { method: 'DELETE', body: { id } });
};
