import type { ParsedArticle, ParsedFeed } from './feed';

export const ARTICLE_RETENTION = 500;

const INITIAL_IMPORT_LIMIT = 30;
const REFRESH_IMPORT_LIMIT = 500;

export type FeedImport = {
  readonly title: string;
  readonly articles: readonly ParsedArticle[];
  readonly retention: number;
};

const selectArticles = (
  articles: readonly ParsedArticle[],
  limit: number,
  now: string
) =>
  articles
    .toSorted((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt)
    )
    .slice(0, limit)
    .map((article) => ({
      ...article,
      publishedAt: article.publishedAt || now,
    }));

export const prepareInitialImport = (
  feed: ParsedFeed,
  now: string
): FeedImport => ({
  title: feed.title,
  articles: selectArticles(feed.articles, INITIAL_IMPORT_LIMIT, now),
  retention: ARTICLE_RETENTION,
});

export const prepareRefreshImport = (
  feed: ParsedFeed,
  now: string
): FeedImport => ({
  title: feed.title,
  articles: selectArticles(feed.articles, REFRESH_IMPORT_LIMIT, now),
  retention: ARTICLE_RETENTION,
});
