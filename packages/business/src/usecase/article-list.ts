import { DateTime, Effect, Option, Schema } from 'effect';
import {
  Article,
  type ArticleCursor,
  type ArticleCursorScope,
  type ArticleFilter,
  encodeArticleCursor,
} from '../entity/article';
import type { FeedId, OwnerId } from '../entity/object-value';
import {
  type ArticleBoundary,
  type ArticleQuery,
  ArticleRepository,
} from '../port/article-repository';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../port/feed-repository';
import { InvalidCursor } from './article-errors';
import { FeedNotFound } from './feeds';

const PAGE_SIZE = 30;

export const ArticlePage = Schema.Struct({
  items: Schema.Array(Article),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export type ArticlePage = typeof ArticlePage.Type;

const scopeKey = (scope: ArticleCursorScope): string =>
  scope.kind === 'later'
    ? 'later'
    : `feeds:${Option.getOrElse(scope.feedId, () => '')}`;

const laterScope: ArticleCursorScope = { kind: 'later' };

const feedScope = (feedId: FeedId | undefined): ArticleCursorScope => ({
  kind: 'feeds',
  feedId: Option.fromUndefinedOr(feedId),
});

const boundaryOf = (article: Article): ArticleBoundary => ({
  publishedAt: DateTime.formatIso(article.publishedAt),
  id: article.id,
});

const boundaryOfCursor = (cursor: ArticleCursor): ArticleBoundary => ({
  publishedAt: DateTime.formatIso(cursor.after.publishedAt),
  id: cursor.after.id,
});

const encodeCursor = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  after: ArticleBoundary
): string =>
  encodeArticleCursor({
    owner,
    scope,
    filter,
    publishedAt: after.publishedAt,
    id: after.id,
  });

const invalidCursor = () =>
  new InvalidCursor({ message: 'Invalid pagination cursor' });

const authorizedCursor = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  cursor: ArticleCursor
): Option.Option<ArticleBoundary> =>
  cursor.owner === owner &&
  cursor.filter === filter &&
  scopeKey(cursor.scope) === scopeKey(scope)
    ? Option.some(boundaryOfCursor(cursor))
    : Option.none();

const cursorBoundary = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  cursor: ArticleCursor
): Effect.Effect<ArticleBoundary, InvalidCursor> =>
  Effect.fromOption(
    authorizedCursor(owner, scope, filter, cursor),
    invalidCursor
  );

const optionalCursorBoundary = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  cursor: ArticleCursor | undefined
): Effect.Effect<ArticleBoundary | undefined, InvalidCursor> =>
  cursor === undefined
    ? Effect.succeed(undefined)
    : cursorBoundary(owner, scope, filter, cursor);

const pageQuery = (
  filter: ArticleFilter,
  after: ArticleBoundary | undefined,
  through: ArticleBoundary | undefined
): ArticleQuery => ({
  filter,
  limit: PAGE_SIZE + 1,
  ...(after === undefined ? {} : { after }),
  ...(through === undefined ? {} : { through }),
});

const tailToken = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  items: ReadonlyArray<Article>
): string | null => {
  const last = items.at(-1);

  return last === undefined
    ? null
    : encodeCursor(owner, scope, filter, boundaryOf(last));
};

const pageOf = (
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  rows: ReadonlyArray<Article>
): ArticlePage => {
  const items = rows.slice(0, PAGE_SIZE);
  const tail = tailToken(owner, scope, filter, items);

  return {
    items,
    cursor: rows.length > PAGE_SIZE ? tail : null,
    boundary: tail,
  };
};

const continuationOf = (
  rows: ReadonlyArray<Article>
): ArticleBoundary | undefined => {
  const last = rows.at(-1);

  return rows.length > PAGE_SIZE && last !== undefined
    ? boundaryOf(last)
    : undefined;
};

const feedSelection = (
  feedId: FeedId | undefined
): Option.Option<ReadonlyArray<FeedId>> =>
  feedId === undefined ? Option.none() : Option.some([feedId]);

export const listLaterArticles = (
  owner: OwnerId,
  filter: ArticleFilter,
  cursor?: ArticleCursor,
  through?: ArticleCursor
) =>
  Effect.gen(function* () {
    const articles = yield* ArticleRepository;
    const after = yield* optionalCursorBoundary(
      owner,
      laterScope,
      filter,
      cursor
    );
    const boundary = yield* optionalCursorBoundary(
      owner,
      laterScope,
      filter,
      through
    );
    const rows = yield* articles.listLater(
      owner,
      pageQuery(filter, after, boundary)
    );

    return pageOf(owner, laterScope, filter, rows);
  });

const requireFeed = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<void, FeedNotFound | FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    if (Option.isNone(yield* feeds.find(owner, feedId))) {
      return yield* new FeedNotFound({
        message: 'Feed not found',
        id: feedId,
      });
    }
  });

export const listFeedArticles = (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ArticleFilter,
  cursor?: ArticleCursor,
  through?: ArticleCursor
) =>
  Effect.gen(function* () {
    if (feedId !== undefined) {
      yield* requireFeed(owner, feedId);
    }

    const articles = yield* ArticleRepository;
    const scope = feedScope(feedId);
    const after = yield* optionalCursorBoundary(owner, scope, filter, cursor);
    const boundary = yield* optionalCursorBoundary(
      owner,
      scope,
      filter,
      through
    );
    const rows = yield* articles.listFeeds(
      owner,
      feedSelection(feedId),
      pageQuery(filter, after, boundary)
    );

    return pageOf(owner, scope, filter, rows);
  });

export const refreshLaterArticles = (
  owner: OwnerId,
  filter: ArticleFilter,
  through: ArticleCursor
) =>
  Effect.gen(function* () {
    const boundary = yield* cursorBoundary(owner, laterScope, filter, through);
    const articles = yield* ArticleRepository;
    const items: Array<Article> = [];
    let after: ArticleBoundary | undefined;

    while (true) {
      const rows = yield* articles.listLater(
        owner,
        pageQuery(filter, after, boundary)
      );
      items.push(...rows);
      const next = continuationOf(rows);
      if (next === undefined) {
        return items;
      }

      after = next;
    }
  });

export const refreshFeedArticles = (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ArticleFilter,
  through: ArticleCursor
) =>
  Effect.gen(function* () {
    if (feedId !== undefined) {
      yield* requireFeed(owner, feedId);
    }

    const scope = feedScope(feedId);
    const boundary = yield* cursorBoundary(owner, scope, filter, through);
    const articles = yield* ArticleRepository;
    const items: Array<Article> = [];
    let after: ArticleBoundary | undefined;

    while (true) {
      const rows = yield* articles.listFeeds(
        owner,
        feedSelection(feedId),
        pageQuery(filter, after, boundary)
      );
      items.push(...rows);
      const next = continuationOf(rows);
      if (next === undefined) {
        return items;
      }

      after = next;
    }
  });
