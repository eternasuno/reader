import type { Article, Feed, Preview } from './library-schema';
import {
  ArticleItemSchema,
  ArticleItemsSchema,
  ArticleOrNullItemSchema,
  ArticlePageSchema,
  FeedItemSchema,
  FeedItemsSchema,
  PreviewItemSchema,
  UnreadCountsSchema,
} from './library-schema';
import { decodeBody, type Send, sendGet, sendJson } from './library-transport';
import type { ArticlePage, Counts, Filter, Scope } from './library-types';

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

  return await decodeBody(
    ArticlePageSchema,
    await sendGet(send, path, { filter, cursor, ...scopeQuery(scope) })
  );
};

export const readRefresh = async (
  send: Send,
  scope: Scope,
  filter: Filter,
  through: string
): Promise<ReadonlyArray<Article>> => {
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

export const readFeeds = async (send: Send): Promise<ReadonlyArray<Feed>> =>
  (await decodeBody(FeedItemsSchema, await sendGet(send, '/api/library/feeds')))
    .items;

export const readUnreadCounts = async (send: Send): Promise<Counts> => {
  const counts = await decodeBody(
    UnreadCountsSchema,
    await sendGet(send, '/api/library/unread')
  );

  return {
    later: counts.later,
    feedsTotal: counts.feedsTotal,
    feeds: Object.fromEntries(
      counts.feeds.map((feed) => [feed.id, feed.count])
    ),
  };
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

export const markFeeds = async (send: Send, feedIds: ReadonlyArray<string>) => {
  await sendJson(send, '/api/library/mark-feeds', { feedIds });
};

export const markArticles = async (send: Send, ids: ReadonlyArray<string>) => {
  await sendJson(send, '/api/library/mark-articles', { ids });
};

export const removeArticle = async (send: Send, id: string) => {
  await send('/api/library/articles', { method: 'DELETE', body: { id } });
};

export const removeSubscription = async (send: Send, id: string) => {
  await send('/api/library/feeds', { method: 'DELETE', body: { id } });
};
