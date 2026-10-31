import { Effect, Option, Schema } from 'effect';
import {
  type Article,
  ArticleFilter,
  ArticleId,
  type ArticlePage,
  FeedId,
  OwnerId,
} from '../entity/model';
import {
  type ArticleBoundary,
  type ArticleQuery,
  type ArticleReadError,
  type ArticleScope,
  Articles,
  type SubscriptionReadError,
  Subscriptions,
} from '../port/reader-store';
import { InvalidCursor } from './article-errors';
import { SubscriptionNotFound } from './subscriptions';

const PAGE_SIZE = 30;

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

const scopeKey = (scope: ArticleScope): string =>
  scope.kind === 'later' ? 'later' : `feeds:${scope.feedId ?? ''}`;

const scopePayload = (scope: ArticleScope) => {
  if (scope.kind === 'later') {
    return { kind: 'later' as const };
  }

  if (scope.feedId === undefined) {
    return { kind: 'feeds' as const };
  }

  return { kind: 'feeds' as const, feedId: scope.feedId };
};

const boundaryOf = (article: Article): ArticleBoundary => ({
  publishedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(
    article.publishedAt
  ),
  id: article.id,
});

const encodeCursor = (
  owner: OwnerId,
  scope: ArticleScope,
  filter: ArticleFilter,
  after: ArticleBoundary
): string => {
  const payload = {
    version: 1 as const,
    owner,
    scope: scopePayload(scope),
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

type CursorScope = (typeof CursorPayload.Type)['scope'];

const asScope = (scope: CursorScope): ArticleScope => {
  if (scope.kind === 'later') {
    return { kind: 'later' };
  }

  if (scope.feedId === undefined) {
    return { kind: 'feeds' };
  }

  return { kind: 'feeds', feedId: scope.feedId };
};

const decodeCursor = (
  owner: OwnerId,
  scope: ArticleScope,
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
        scopeKey(asScope(payload.scope)) !== scopeKey(scope)
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
  scope: ArticleScope,
  filter: ArticleFilter,
  value: string | undefined
): Effect.Effect<ArticleBoundary | undefined, InvalidCursor> =>
  value === undefined
    ? Effect.succeed(undefined)
    : decodeCursor(owner, scope, filter, value);

const pageQuery = (
  scope: ArticleScope,
  filter: ArticleFilter,
  after: ArticleBoundary | undefined,
  boundary: ArticleBoundary | undefined
): ArticleQuery => ({
  scope,
  filter,
  limit: PAGE_SIZE + 1,
  ...(after === undefined ? {} : { after }),
  ...(boundary === undefined ? {} : { through: boundary }),
});

const tailToken = (
  owner: OwnerId,
  scope: ArticleScope,
  filter: ArticleFilter,
  items: readonly Article[]
): string | null => {
  const last = items.at(-1);

  return last === undefined
    ? null
    : encodeCursor(owner, scope, filter, boundaryOf(last));
};

const listPage = (
  owner: OwnerId,
  scope: ArticleScope,
  filter: ArticleFilter,
  cursor: string | undefined,
  through: string | undefined
): Effect.Effect<ArticlePage, InvalidCursor | ArticleReadError, Articles> =>
  Effect.gen(function* () {
    const articles = yield* Articles;
    const after = yield* decodeOptionalCursor(owner, scope, filter, cursor);
    const boundary = yield* decodeOptionalCursor(owner, scope, filter, through);
    const rows = yield* articles.list(
      owner,
      pageQuery(scope, filter, after, boundary)
    );
    const items = rows.slice(0, PAGE_SIZE);
    const tail = tailToken(owner, scope, filter, items);

    return {
      items,
      cursor: rows.length > PAGE_SIZE ? tail : null,
      boundary: tail,
    };
  });

const feedScope = (feedId: FeedId | undefined): ArticleScope =>
  feedId === undefined ? { kind: 'feeds' } : { kind: 'feeds', feedId };

const refreshPage = (
  owner: OwnerId,
  scope: ArticleScope,
  filter: ArticleFilter,
  boundary: ArticleBoundary
): Effect.Effect<readonly Article[], ArticleReadError, Articles> =>
  Effect.gen(function* () {
    const articles = yield* Articles;
    const items: Article[] = [];
    let after: ArticleBoundary | undefined;

    while (true) {
      const query: ArticleQuery = {
        scope,
        filter,
        limit: PAGE_SIZE + 1,
        through: boundary,
        ...(after === undefined ? {} : { after }),
      };
      const rows = yield* articles.list(owner, query);
      items.push(...rows);
      const last = rows.at(-1);
      if (rows.length <= PAGE_SIZE || last === undefined) {
        break;
      }

      after = boundaryOf(last);
    }

    return items;
  });

export const listLaterArticles = Effect.fn('articles.listLater')(function* (
  owner: OwnerId,
  filter: ArticleFilter,
  cursor?: string,
  through?: string
) {
  return yield* listPage(owner, { kind: 'later' }, filter, cursor, through);
});

const requireFeed = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<
  void,
  SubscriptionNotFound | SubscriptionReadError,
  Subscriptions
> =>
  Effect.gen(function* () {
    const subscriptions = yield* Subscriptions;
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

  return yield* listPage(owner, feedScope(feedId), filter, cursor, through);
});

export const refreshLaterArticles = Effect.fn('articles.refreshLater')(
  function* (owner: OwnerId, filter: ArticleFilter, through: string) {
    const scope: ArticleScope = { kind: 'later' };
    const boundary = yield* decodeCursor(owner, scope, filter, through);

    return yield* refreshPage(owner, scope, filter, boundary);
  }
);

export const refreshFeedArticles = Effect.fn('articles.refreshFeeds')(
  function* (
    owner: OwnerId,
    feedId: FeedId | undefined,
    filter: ArticleFilter,
    through: string
  ) {
    const scope = feedScope(feedId);
    if (feedId !== undefined) {
      yield* requireFeed(owner, feedId);
    }

    const boundary = yield* decodeCursor(owner, scope, filter, through);

    return yield* refreshPage(owner, scope, filter, boundary);
  }
);
