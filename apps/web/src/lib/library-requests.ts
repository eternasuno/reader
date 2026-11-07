import { Option } from 'effect';
import type { Feed, FeedItem, Preview, SavedPage } from './library-schema';
import {
  FeedItemOrNullResponseSchema,
  FeedItemPageSchema,
  FeedItemResponseSchema,
  FeedItemsResponseSchema,
  FeedResponseSchema,
  FeedsResponseSchema,
  PreviewResponseSchema,
  SavedPageOrNullResponseSchema,
  SavedPagePageSchema,
  SavedPageResponseSchema,
  SavedPagesResponseSchema,
  UnreadCountsSchema,
} from './library-schema';
import { decodeBody, type Send, sendGet, sendJson } from './library-transport';
import type {
  Article,
  ArticlePage,
  ArticleRef,
  Counts,
  Filter,
  Scope,
} from './library-types';

const fromFeedItem = (item: FeedItem): Article => ({
  id: item.id,
  feedId: Option.some(item.feedId),
  url: item.url,
  title: item.title,
  description: item.description,
  content: item.content,
  extractedContent: item.extractedContent,
  publishedAt: item.publishedAt,
  read: item.read,
});

const fromSavedPage = (page: SavedPage): Article => ({
  id: page.id,
  feedId: Option.none(),
  url: page.url,
  title: page.title,
  description: page.description,
  content: Option.some(page.content),
  extractedContent: Option.some(page.content),
  publishedAt: page.publishedAt,
  read: page.read,
});

export const refOf = (article: Article): ArticleRef => ({
  id: article.id,
  feedId: Option.getOrUndefined(article.feedId),
});

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
  if (scope.kind === 'later') {
    const page = await decodeBody(
      SavedPagePageSchema,
      await sendGet(send, '/api/library/saved-pages', { filter, cursor })
    );

    return { ...page, items: page.items.map(fromSavedPage) };
  }

  const page = await decodeBody(
    FeedItemPageSchema,
    await sendGet(send, '/api/library/feeds/items', {
      filter,
      cursor,
      ...scopeQuery(scope),
    })
  );

  return { ...page, items: page.items.map(fromFeedItem) };
};

export const readRefresh = async (
  send: Send,
  scope: Scope,
  filter: Filter,
  through: string
): Promise<ReadonlyArray<Article>> => {
  if (scope.kind === 'later') {
    const response = await decodeBody(
      SavedPagesResponseSchema,
      await sendGet(send, '/api/library/saved-pages/refresh', {
        filter,
        through,
      })
    );

    return response.items.map(fromSavedPage);
  }

  const response = await decodeBody(
    FeedItemsResponseSchema,
    await sendGet(send, '/api/library/feeds/items/refresh', {
      filter,
      through,
      ...scopeQuery(scope),
    })
  );

  return response.items.map(fromFeedItem);
};

export const readFeeds = async (send: Send): Promise<ReadonlyArray<Feed>> =>
  (
    await decodeBody(
      FeedsResponseSchema,
      await sendGet(send, '/api/library/feeds')
    )
  ).items;

export const readUnreadCounts = async (send: Send): Promise<Counts> => {
  const counts = await decodeBody(
    UnreadCountsSchema,
    await sendGet(send, '/api/library/unread')
  );

  return {
    later: counts.saved,
    feedsTotal: counts.feedsTotal,
    feeds: Object.fromEntries(
      counts.feeds.map((feed) => [feed.id, feed.count])
    ),
  };
};

export const readSavedPage = async (
  send: Send,
  path: string,
  body: unknown
): Promise<Article> =>
  fromSavedPage(
    (
      await decodeBody(
        SavedPageResponseSchema,
        await sendJson(send, path, body)
      )
    ).item
  );

export const readFeedItem = async (
  send: Send,
  path: string,
  body: unknown
): Promise<Article> =>
  fromFeedItem(
    (await decodeBody(FeedItemResponseSchema, await sendJson(send, path, body)))
      .item
  );

export const readArticleByRef = async (
  send: Send,
  ref: ArticleRef
): Promise<Article | null> => {
  if (ref.feedId === undefined) {
    const { item } = await decodeBody(
      SavedPageOrNullResponseSchema,
      await sendGet(send, '/api/library/saved-pages/item', { id: ref.id })
    );

    return item === null ? null : fromSavedPage(item);
  }

  const { item } = await decodeBody(
    FeedItemOrNullResponseSchema,
    await sendGet(send, '/api/library/feeds/items/item', {
      feedId: ref.feedId,
      id: ref.id,
    })
  );

  return item === null ? null : fromFeedItem(item);
};

export const readPreview = async (send: Send, url: string): Promise<Preview> =>
  (
    await decodeBody(
      PreviewResponseSchema,
      await sendJson(send, '/api/library/feeds/preview', { url })
    )
  ).preview;

export const readSubscription = async (
  send: Send,
  url: string
): Promise<Feed> =>
  (
    await decodeBody(
      FeedResponseSchema,
      await sendJson(send, '/api/library/feeds', { url })
    )
  ).item;

export const markRead = async (send: Send, ref: ArticleRef, read: boolean) => {
  if (ref.feedId === undefined) {
    await send('/api/library/saved-pages', {
      method: 'PATCH',
      body: { id: ref.id, read },
    });

    return;
  }

  await send('/api/library/feeds/items', {
    method: 'PATCH',
    body: { feedId: ref.feedId, id: ref.id, read },
  });
};

export const markLater = async (send: Send) => {
  await sendJson(send, '/api/library/saved-pages/mark-all-read', {});
};

export const markFeeds = async (send: Send, feedIds: ReadonlyArray<string>) => {
  await sendJson(send, '/api/library/feeds/mark-read', { feedIds });
};

export const markArticles = async (
  send: Send,
  refs: ReadonlyArray<ArticleRef>
) => {
  const saved = refs.filter((ref) => ref.feedId === undefined);
  if (saved.length > 0) {
    await sendJson(send, '/api/library/saved-pages/mark-read', {
      ids: saved.map((ref) => ref.id),
    });
  }

  const byFeed = new Map<string, Array<string>>();
  for (const ref of refs) {
    if (ref.feedId !== undefined) {
      byFeed.set(ref.feedId, [...(byFeed.get(ref.feedId) ?? []), ref.id]);
    }
  }

  for (const [feedId, ids] of byFeed) {
    await sendJson(send, '/api/library/feeds/items/mark-read', {
      feedId,
      ids,
    });
  }
};

export const removeSavedPage = async (send: Send, id: string) => {
  await send('/api/library/saved-pages', { method: 'DELETE', body: { id } });
};

export const removeSubscription = async (send: Send, id: string) => {
  await send('/api/library/feeds', { method: 'DELETE', body: { id } });
};
