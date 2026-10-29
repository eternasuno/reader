import {
  ArticleContent,
  ArticleFailure,
  ArticleSource,
  DuplicateFeed,
  DuplicateLink,
  Feed,
  FeedFetchError,
  FeedNotFound,
  FeedPage,
  InvalidFeed,
  InvalidLink,
  LinkNotFound,
  LinkPage,
  ReadingLink,
} from '@reader/business';
import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';

export {
  DuplicateLink,
  InvalidLink,
  LinkNotFound,
  LinkPage,
  ReadingLink,
} from '@reader/business';

export class LinksUnavailable extends Schema.TaggedError<LinksUnavailable>()(
  'LinksUnavailable',
  { error: Schema.String }
) {}

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
    error: [LinksUnavailable.pipe(HttpApiSchema.status(500)), unauthorized],
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
    error: [LinksUnavailable.pipe(HttpApiSchema.status(500)), unauthorized],
  }),
  HttpApiEndpoint.post('add', '/api/links', {
    payload: Schema.Struct({
      url: Schema.String.check(Schema.isMaxLength(4096)),
    }),
    success: Schema.Struct({ item: ReadingLink }).pipe(
      HttpApiSchema.status(201)
    ),
    error: [
      InvalidLink.pipe(HttpApiSchema.status(400)),
      DuplicateLink.pipe(HttpApiSchema.status(409)),
      LinksUnavailable.pipe(HttpApiSchema.status(500)),
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.patch('mark', '/api/links', {
    payload: Schema.Struct({ key, read: Schema.Boolean }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinkNotFound.pipe(HttpApiSchema.status(404)),
      LinksUnavailable.pipe(HttpApiSchema.status(500)),
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.post('markAll', '/api/links/mark-all', {
    payload: Schema.Struct({}),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinksUnavailable.pipe(HttpApiSchema.status(500)),
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.post('markLoaded', '/api/links/mark-loaded', {
    payload: loadedKeys,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinksUnavailable.pipe(HttpApiSchema.status(500)),
      unauthorized,
      forbidden,
    ],
  }),
  HttpApiEndpoint.delete('remove', '/api/links', {
    payload: Schema.Struct({ key }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      LinkNotFound.pipe(HttpApiSchema.status(404)),
      LinksUnavailable.pipe(HttpApiSchema.status(500)),
      unauthorized,
      forbidden,
    ],
  })
);

const feedErrors = [
  LinksUnavailable.pipe(HttpApiSchema.status(500)),
  unauthorized,
  forbidden,
];

const feedKey = Schema.Struct({ key });

const feeds = HttpApiGroup.make('feeds').add(
  HttpApiEndpoint.get('list', '/api/feeds', {
    success: Schema.Struct({ items: Schema.Array(Feed) }),
    error: feedErrors,
  }),
  HttpApiEndpoint.post('subscribe', '/api/feeds', {
    payload: Schema.Struct({
      url: Schema.String.check(Schema.isMaxLength(4096)),
    }),
    success: Schema.Struct({ item: Feed }),
    error: [
      ...feedErrors,
      InvalidFeed.pipe(HttpApiSchema.status(400)),
      DuplicateFeed.pipe(HttpApiSchema.status(409)),
      FeedFetchError.pipe(HttpApiSchema.status(422)),
    ],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/feeds', {
    payload: feedKey,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [...feedErrors, FeedNotFound.pipe(HttpApiSchema.status(404))],
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
    error: [...feedErrors, FeedNotFound.pipe(HttpApiSchema.status(404))],
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
      FeedNotFound.pipe(HttpApiSchema.status(404)),
      InvalidLink.pipe(HttpApiSchema.status(400)),
      DuplicateLink.pipe(HttpApiSchema.status(409)),
    ],
  })
);

export type { Feed, FeedArticle } from '@reader/business';

const articleRef = { kind: Schema.Literals(['link', 'feed']), key };

const articleErrors = [
  ArticleFailure.pipe(HttpApiSchema.status(422)),
  unauthorized,
  forbidden,
];

const reader = HttpApiGroup.make('reader').add(
  HttpApiEndpoint.get('settings', '/api/reader/settings', {
    success: Schema.Struct({ configured: Schema.Boolean }),
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
