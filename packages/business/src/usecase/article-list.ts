import { Effect, Option, Schema } from 'effect';
import { Article } from '../entity/article';
import { ArticleId, FeedId, OwnerId } from '../entity/object-value';
import {
  type ArticleBoundary,
  ArticleFilter,
  type ArticleQuery,
  ArticleRepository,
} from '../port/article-repository';
import {
  FeedRepository,
  type SubscriptionReadError,
} from '../port/feed-repository';
import { InvalidCursor } from './article-errors';
import { SubscriptionNotFound } from './subscriptions';

const PAGE_SIZE = 30;

export const ArticlePage = Schema.Struct({
  items: Schema.Array(Article),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export type ArticlePage = typeof ArticlePage.Type;

const CursorPayload = Schema.Struct({
  version: Schema.Literals([1]),
  owner: OwnerId,
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literals(['later']) }),
    Schema.Struct({
      kind: Schema.Literals(['feeds']),
      feedId: Schema.optional(FeedId),
    }),
  ]),
  filter: ArticleFilter,
  after: Schema.Struct({
    publishedAt: Schema.DateTimeUtcFromString,
    id: ArticleId,
  }),
});

type CursorScope = (typeof CursorPayload.Type)['scope'];

const encodeBase64 = (value: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const decodeBase64 = (value: string): string => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

const scopeKey = (scope: CursorScope): string =>
  scope.kind === 'later' ? 'later' : `feeds:${scope.feedId ?? ''}`;

const laterScope: CursorScope = { kind: 'later' };

const feedScope = (feedId: FeedId | undefined): CursorScope =>
  feedId === undefined ? { kind: 'feeds' } : { kind: 'feeds', feedId };

const boundaryOf = (article: Article): ArticleBoundary => ({
  publishedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(
    article.publishedAt
  ),
  id: article.id,
});

const encodeCursor = (
  owner: OwnerId,
  scope: CursorScope,
  filter: ArticleFilter,
  after: ArticleBoundary
): string => {
  const payload = {
    version: 1 as const,
    owner,
    scope,
    filter,
    after: {
      publishedAt: Schema.decodeSync(Schema.DateTimeUtcFromString)(
        after.publishedAt
      ),
      id: after.id,
    },
  };

  return encodeBase64(
    JSON.stringify(Schema.encodeSync(CursorPayload)(payload))
  );
};

const decodeCursor = (
  owner: OwnerId,
  scope: CursorScope,
  filter: ArticleFilter,
  value: string
): Effect.Effect<ArticleBoundary, InvalidCursor> =>
  Effect.try({
    try: () => {
      const payload = Schema.decodeUnknownSync(CursorPayload)(
        JSON.parse(decodeBase64(value))
      );
      if (
        payload.owner !== owner ||
        payload.filter !== filter ||
        scopeKey(payload.scope) !== scopeKey(scope)
      ) {
        throw new Error('cursor does not match the requested page');
      }

      return {
        publishedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(
          payload.after.publishedAt
        ),
        id: payload.after.id,
      };
    },
    catch: () => new InvalidCursor({ message: 'Invalid pagination cursor' }),
  });

const decodeOptionalCursor = (
  owner: OwnerId,
  scope: CursorScope,
  filter: ArticleFilter,
  value: string | undefined
): Effect.Effect<ArticleBoundary | undefined, InvalidCursor> =>
  value === undefined
    ? Effect.succeed(undefined)
    : decodeCursor(owner, scope, filter, value);

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
  scope: CursorScope,
  filter: ArticleFilter,
  items: readonly Article[]
): string | null => {
  const last = items.at(-1);

  return last === undefined
    ? null
    : encodeCursor(owner, scope, filter, boundaryOf(last));
};

const pageOf = (
  owner: OwnerId,
  scope: CursorScope,
  filter: ArticleFilter,
  rows: readonly Article[]
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
  rows: readonly Article[]
): ArticleBoundary | undefined => {
  const last = rows.at(-1);

  return rows.length > PAGE_SIZE && last !== undefined
    ? boundaryOf(last)
    : undefined;
};

export const listLaterArticles = Effect.fn('articles.listLater')(function* (
  owner: OwnerId,
  filter: ArticleFilter,
  cursor?: string,
  through?: string
) {
  const articles = yield* ArticleRepository;
  const after = yield* decodeOptionalCursor(owner, laterScope, filter, cursor);
  const boundary = yield* decodeOptionalCursor(
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
): Effect.Effect<
  void,
  SubscriptionNotFound | SubscriptionReadError,
  FeedRepository
> =>
  Effect.gen(function* () {
    const subscriptions = yield* FeedRepository;
    if (Option.isNone(yield* subscriptions.find(owner, feedId))) {
      return yield* new SubscriptionNotFound({
        message: 'Subscription not found',
        id: feedId,
      });
    }
  });

export const listFeedArticles = Effect.fn('articles.listFeeds')(function* (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ArticleFilter,
  cursor?: string,
  through?: string
) {
  if (feedId !== undefined) {
    yield* requireFeed(owner, feedId);
  }

  const articles = yield* ArticleRepository;
  const scope = feedScope(feedId);
  const after = yield* decodeOptionalCursor(owner, scope, filter, cursor);
  const boundary = yield* decodeOptionalCursor(owner, scope, filter, through);
  const rows = yield* articles.listFeeds(
    owner,
    feedId,
    pageQuery(filter, after, boundary)
  );

  return pageOf(owner, scope, filter, rows);
});

export const refreshLaterArticles = Effect.fn('articles.refreshLater')(
  function* (owner: OwnerId, filter: ArticleFilter, through: string) {
    const boundary = yield* decodeCursor(owner, laterScope, filter, through);
    const articles = yield* ArticleRepository;
    const items: Article[] = [];
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
  }
);

export const refreshFeedArticles = Effect.fn('articles.refreshFeeds')(
  function* (
    owner: OwnerId,
    feedId: FeedId | undefined,
    filter: ArticleFilter,
    through: string
  ) {
    if (feedId !== undefined) {
      yield* requireFeed(owner, feedId);
    }

    const scope = feedScope(feedId);
    const boundary = yield* decodeCursor(owner, scope, filter, through);
    const articles = yield* ArticleRepository;
    const items: Article[] = [];
    let after: ArticleBoundary | undefined;

    while (true) {
      const rows = yield* articles.listFeeds(
        owner,
        feedId,
        pageQuery(filter, after, boundary)
      );
      items.push(...rows);
      const next = continuationOf(rows);
      if (next === undefined) {
        return items;
      }

      after = next;
    }
  }
);
