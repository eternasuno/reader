import type { Article, Feed, Preview } from './library-schema';
import {
  ArticleItemSchema,
  ArticleItemsSchema,
  ArticleOrNullItemSchema,
  ArticlePageSchema,
  FeedItemSchema,
  FeedItemsSchema,
  FeedsUnreadSchema,
  LaterUnreadSchema,
  PreviewItemSchema,
} from './library-schema';
import { decodeBody, type Send, sendGet, sendJson } from './library-transport';
import type {
  ArticlePage,
  Counts,
  FeedUnread,
  Filter,
  Scope,
} from './library-types';

const scopeQuery = (
  scope: Scope
): Readonly<Record<string, string | undefined>> =>
  scope.kind === 'feeds' && scope.feedId !== undefined
    ? { feedId: scope.feedId }
    : {};

export const readPage = async (
  send: Send,
  scope: Scope,
  filter: Filter,
  cursor?: string
): Promise<ArticlePage> => {
  const path =
    scope.kind === 'later'
      ? '/api/library/later'
      : '/api/library/feeds/articles';
  const page = await decodeBody(
    ArticlePageSchema,
    await sendGet(send, path, { filter, cursor, ...scopeQuery(scope) })
  );

  return {
    items: page.items,
    cursor: page.cursor,
    boundary: page.boundary ?? null,
  };
};

export const readRefresh = async (
  send: Send,
  scope: Scope,
  filter: Filter,
  through: string
): Promise<readonly Article[]> => {
  const path =
    scope.kind === 'later'
      ? '/api/library/later/refresh'
      : '/api/library/feeds/refresh';

  return (
    await decodeBody(
      ArticleItemsSchema,
      await sendGet(send, path, { filter, through, ...scopeQuery(scope) })
    )
  ).items;
};

export const readFeeds = async (send: Send): Promise<readonly Feed[]> =>
  (await decodeBody(FeedItemsSchema, await sendGet(send, '/api/library/feeds')))
    .items;

export const readLaterUnread = async (send: Send): Promise<number> =>
  (
    await decodeBody(
      LaterUnreadSchema,
      await sendGet(send, '/api/library/later/unread')
    )
  ).count;

export const readFeedUnread = async (send: Send): Promise<FeedUnread> => {
  const counts = await decodeBody(
    FeedsUnreadSchema,
    await sendGet(send, '/api/library/feeds/unread')
  );

  return {
    total: counts.total,
    feeds: Object.fromEntries(
      counts.feeds.map((feed) => [feed.id, feed.count])
    ),
  };
};

export const readCounts = async (send: Send): Promise<Counts> => {
  const [later, feeds] = await Promise.all([
    readLaterUnread(send),
    readFeedUnread(send),
  ]);

  return { later, feeds: feeds.feeds, feedsTotal: feeds.total };
};

export const readArticle = async (
  send: Send,
  path: string,
  body: unknown
): Promise<Article> =>
  (await decodeBody(ArticleItemSchema, await sendJson(send, path, body))).item;

export const readArticleById = async (
  send: Send,
  id: string
): Promise<Article | null> =>
  (
    await decodeBody(
      ArticleOrNullItemSchema,
      await sendGet(send, '/api/library/articles', { id })
    )
  ).item;

export const readPreview = async (send: Send, url: string): Promise<Preview> =>
  (
    await decodeBody(
      PreviewItemSchema,
      await sendJson(send, '/api/library/feeds/preview', { url })
    )
  ).preview;

export const readSubscription = async (
  send: Send,
  url: string
): Promise<Feed> =>
  (
    await decodeBody(
      FeedItemSchema,
      await sendJson(send, '/api/library/feeds', { url })
    )
  ).item;

export const markRead = async (send: Send, id: string, read: boolean) => {
  await send('/api/library/articles', { method: 'PATCH', body: { id, read } });
};

export const markLater = async (send: Send) => {
  await sendJson(send, '/api/library/mark-later', {});
};

export const markFeeds = async (send: Send, feedIds: readonly string[]) => {
  await sendJson(send, '/api/library/mark-feeds', { feedIds });
};

export const markArticles = async (send: Send, ids: readonly string[]) => {
  await sendJson(send, '/api/library/mark-articles', { ids });
};

export const removeArticle = async (send: Send, id: string) => {
  await send('/api/library/articles', { method: 'DELETE', body: { id } });
};

export const removeSubscription = async (send: Send, id: string) => {
  await send('/api/library/feeds', { method: 'DELETE', body: { id } });
};
