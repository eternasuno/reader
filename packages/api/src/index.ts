import {
  ArticleContent,
  ArticleSource,
  Feed,
  FeedPage,
  FeedPreview,
  LinkPage,
  ReaderProvider,
  ReadingLink,
} from '@reader/business';
import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import {
  ArticleExtractErrorSchema,
  ArticleFailureSchema,
  ArticleRepositoryErrorSchema,
  DuplicateLinkSchema,
  FeedFetchErrorSchema,
  FeedNotFoundSchema,
  FeedPreviewStoreErrorSchema,
  InvalidFeedSchema,
  InvalidLinkSchema,
  InvalidPreviewSchema,
  LinkNotFoundSchema,
  LinksUnavailableSchema,
  ReaderCredentialsErrorSchema,
  WebpageFetchErrorSchema,
} from './errors';

export {
  DuplicateLink,
  InvalidLink,
  LinkNotFound,
  LinkPage,
  ReadingLink,
} from '@reader/business';
export * from './errors';

const key = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const loadedKeys = Schema.Struct({
  keys: Schema.Array(key).check(Schema.isMaxLength(5000)),
});

const unauthorized = Schema.Struct({
  error: Schema.Literal('Unauthorized'),
}).pipe(HttpApiSchema.status(401));

const forbidden = Schema.Struct({
  error: Schema.Literal('不允许跨站修改'),
}).pipe(HttpApiSchema.status(403));

const links = HttpApiGroup.make('links').add(
  HttpApiEndpoint.get('unreadCount', '/api/links/unread-count', {
    success: Schema.Struct({ count: Schema.Number }),
    error: [LinksUnavailableSchema, unauthorized],
  }),
  HttpApiEndpoint.get('list', '/api/links', {
    query: {
      read: Schema.optional(Schema.Boolean),
      offset: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100000 }))
      ),
      all: Schema.optional(Schema.Boolean),
      before: Schema.optional(Schema.String),
      beforeKey: Schema.optional(Schema.String),
    },
    success: LinkPage,
    error: [LinksUnavailableSchema, unauthorized],
  }),
  HttpApiEndpoint.post('add', '/api/links', {
    payload: Schema.Struct({
      url: Schema.String.check(Schema.isMaxLength(4096)),
    }),
    success: Schema.Struct({ item: ReadingLink }).pipe(
      HttpApiSchema.status(201)
    ),
    error: [
      InvalidLinkSchema,
      DuplicateLinkSchema,
      LinksUnavailableSchema,
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.patch('mark', '/api/links', {
    payload: Schema.Struct({ key, read: Schema.Boolean }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinkNotFoundSchema,
      LinksUnavailableSchema,
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.post('markAll', '/api/links/mark-all', {
    payload: Schema.Struct({}),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [LinksUnavailableSchema, unauthorized, forbidden],
  }),
  HttpApiEndpoint.post('markLoaded', '/api/links/mark-loaded', {
    payload: loadedKeys,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [LinksUnavailableSchema, unauthorized, forbidden],
  }),
  HttpApiEndpoint.delete('remove', '/api/links', {
    payload: Schema.Struct({ key }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinkNotFoundSchema,
      LinksUnavailableSchema,
      unauthorized,
      forbidden,
    ],
  })
);

const feedErrors = [LinksUnavailableSchema, unauthorized, forbidden];

const feedKey = Schema.Struct({ key });

const feeds = HttpApiGroup.make('feeds').add(
  HttpApiEndpoint.get('list', '/api/feeds', {
    success: Schema.Struct({ items: Schema.Array(Feed) }),
    error: feedErrors,
  }),
  HttpApiEndpoint.post('preview', '/api/feeds/preview', {
    payload: Schema.Struct({
      url: Schema.String.check(Schema.isMaxLength(4096)),
    }),
    success: Schema.Struct({ preview: FeedPreview }),
    error: [
      ...feedErrors,
      InvalidFeedSchema,
      FeedFetchErrorSchema,
      FeedPreviewStoreErrorSchema,
    ],
  }),
  HttpApiEndpoint.post('subscribe', '/api/feeds', {
    payload: Schema.Struct({
      token: Schema.String.check(Schema.isMaxLength(128)),
    }),
    success: Schema.Struct({ item: Feed }),
    error: [...feedErrors, InvalidPreviewSchema],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/feeds', {
    payload: feedKey,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [...feedErrors, FeedNotFoundSchema],
  }),
  HttpApiEndpoint.get('articles', '/api/feeds/articles', {
    query: {
      feedKey: Schema.String,
      read: Schema.optional(Schema.Boolean),
      offset: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100000 }))
      ),
      all: Schema.optional(Schema.Boolean),
      before: Schema.optional(Schema.String),
      beforeKey: Schema.optional(Schema.String),
    },
    success: FeedPage,
    error: feedErrors,
  }),
  HttpApiEndpoint.patch('mark', '/api/feeds/articles', {
    payload: Schema.Struct({ key, read: Schema.Boolean }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [...feedErrors, FeedNotFoundSchema],
  }),
  HttpApiEndpoint.post('markAll', '/api/feeds/articles/mark-all', {
    payload: Schema.Struct({ feedKey: Schema.String }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: feedErrors,
  }),
  HttpApiEndpoint.post('markLoaded', '/api/feeds/articles/mark-loaded', {
    payload: loadedKeys,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: feedErrors,
  }),
  HttpApiEndpoint.post('save', '/api/feeds/articles/save', {
    payload: feedKey,
    success: Schema.Struct({ item: ReadingLink }),
    error: [
      ...feedErrors,
      FeedNotFoundSchema,
      InvalidLinkSchema,
      DuplicateLinkSchema,
    ],
  })
);

export type { Feed, FeedArticle, FeedPreview } from '@reader/business';

const articleRef = { kind: Schema.Literals(['link', 'feed']), key };

const articleErrors = [
  ArticleFailureSchema,
  ArticleExtractErrorSchema,
  ArticleRepositoryErrorSchema,
  ReaderCredentialsErrorSchema,
  WebpageFetchErrorSchema,
  unauthorized,
  forbidden,
];

const reader = HttpApiGroup.make('reader').add(
  HttpApiEndpoint.get('settings', '/api/reader/settings', {
    success: Schema.Struct({
      configured: Schema.Boolean,
      jinaConfigured: Schema.Boolean,
      provider: ReaderProvider,
      browserEndpoint: Schema.String,
    }),
    error: articleErrors,
  }),
  HttpApiEndpoint.put('setKey', '/api/reader/settings', {
    payload: Schema.Struct({
      key: Schema.String.check(Schema.isMaxLength(2048)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.delete('deleteKey', '/api/reader/settings', {
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.put('setProvider', '/api/reader/provider', {
    payload: Schema.Struct({ provider: ReaderProvider }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.put('setBrowserEndpoint', '/api/reader/browser', {
    payload: Schema.Struct({
      endpoint: Schema.String.check(Schema.isMaxLength(2048)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.get('content', '/api/reader/content', {
    query: articleRef,
    success: Schema.Struct({
      item: Schema.NullOr(ArticleContent),
      source: ArticleSource,
    }),
    error: articleErrors,
  }),
  HttpApiEndpoint.post('extract', '/api/reader/content', {
    payload: Schema.Struct({ ...articleRef, refresh: Schema.Boolean }),
    success: Schema.Struct({
      item: Schema.NullOr(ArticleContent),
      source: ArticleSource,
    }),
    error: articleErrors,
  })
);

export type { ArticleContent } from '@reader/business';

export const ReaderApi = HttpApi.make('reader').add(links, feeds, reader);
