import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import {
  Article,
  ArticleFilter,
  ArticleId,
  ArticlePage,
  Feed,
  FeedId,
  ReadingSettings,
  SubscriptionPreview,
} from '../../business/src/entity/model.ts';

const failure = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.Literal(tag),
    message: Schema.String,
    id: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
  }).pipe(HttpApiSchema.status(status));

export const UnauthorizedSchema = Schema.Struct({
  error: Schema.Literal('Unauthorized'),
}).pipe(HttpApiSchema.status(401));

export const ForbiddenSchema = Schema.Struct({
  error: Schema.Literal('Cross-site modification is not allowed'),
}).pipe(HttpApiSchema.status(403));

export const InvalidArticleUrlSchema = failure('InvalidArticleUrl', 400);
export const ArticleNotFoundSchema = failure('ArticleNotFound', 404);
export const ArticleNotInFeedSchema = failure('ArticleNotInFeed', 409);
export const ArticleNotLaterSchema = failure('ArticleNotLater', 409);
export const ArticleMissingUrlSchema = failure('ArticleMissingUrl', 422);
export const ArticleEmptyContentSchema = failure('ArticleEmptyContent', 422);
export const DuplicateArticleSchema = failure('DuplicateArticle', 409);
export const InvalidCursorSchema = failure('InvalidCursor', 400);
export const ArticleReadErrorSchema = failure('ArticleReadError', 500);
export const ArticleWriteErrorSchema = failure('ArticleWriteError', 500);
export const ReaderCredentialsErrorSchema = failure(
  'ReaderCredentialsError',
  422
);
export const WebpageFetchErrorSchema = failure('WebpageFetchError', 422);
export const ArticleExtractErrorSchema = failure('ArticleExtractError', 422);

export const SubscriptionUrlInvalidSchema = failure(
  'SubscriptionUrlInvalid',
  400
);
export const SubscriptionExistsSchema = failure('SubscriptionExists', 409);
export const SubscriptionNotFoundSchema = failure('SubscriptionNotFound', 404);
export const SubscriptionImportFailedSchema = failure(
  'SubscriptionImportFailed',
  422
);
export const SubscriptionRefreshFailedSchema = failure(
  'SubscriptionRefreshFailed',
  422
);
export const FetchSubscriptionErrorSchema = failure(
  'FetchSubscriptionError',
  422
);
export const ParseSubscriptionErrorSchema = failure(
  'ParseSubscriptionError',
  422
);
export const SubscriptionReadErrorSchema = failure(
  'SubscriptionReadError',
  500
);
export const SubscriptionWriteErrorSchema = failure(
  'SubscriptionWriteError',
  500
);

export const SettingsReadErrorSchema = failure('SettingsReadError', 500);
export const SettingsSaveErrorSchema = failure('SettingsSaveError', 500);
export const InvalidRetentionSchema = failure('InvalidRetention', 400);
export const InvalidKeySchema = failure('InvalidKey', 400);
export const InvalidEndpointSchema = failure('InvalidEndpoint', 400);
export const InvalidProviderSchema = failure('InvalidProvider', 400);
export const ExtractionSettingsReadErrorSchema = failure(
  'ExtractionSettingsReadError',
  500
);
export const ExtractionSettingsWriteErrorSchema = failure(
  'ExtractionSettingsWriteError',
  500
);

const authErrors = [UnauthorizedSchema, ForbiddenSchema];

const articleReadErrors = [
  InvalidCursorSchema,
  ArticleReadErrorSchema,
  ...authErrors,
];

const articleWriteErrors = [ArticleWriteErrorSchema, ...authErrors];

const subscriptionReadErrors = [SubscriptionReadErrorSchema, ...authErrors];

const pageQuery = {
  filter: Schema.optional(ArticleFilter),
  cursor: Schema.optional(Schema.String),
  through: Schema.optional(Schema.String),
};

const refreshQuery = {
  filter: Schema.optional(ArticleFilter),
  through: Schema.String,
};

const articleId = { id: ArticleId };

const urlPayload = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(4096)),
});

const library = HttpApiGroup.make('library').add(
  HttpApiEndpoint.get('laterList', '/api/library/later', {
    query: pageQuery,
    success: ArticlePage,
    error: articleReadErrors,
  }),
  HttpApiEndpoint.get('feedArticles', '/api/library/feeds/articles', {
    query: { ...pageQuery, feedId: Schema.optional(FeedId) },
    success: ArticlePage,
    error: [
      ...articleReadErrors,
      SubscriptionNotFoundSchema,
      SubscriptionReadErrorSchema,
    ],
  }),
  HttpApiEndpoint.get('laterRefresh', '/api/library/later/refresh', {
    query: refreshQuery,
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: articleReadErrors,
  }),
  HttpApiEndpoint.get('feedRefresh', '/api/library/feeds/refresh', {
    query: { ...refreshQuery, feedId: Schema.optional(FeedId) },
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: [
      ...articleReadErrors,
      SubscriptionNotFoundSchema,
      SubscriptionReadErrorSchema,
    ],
  }),
  HttpApiEndpoint.get('feeds', '/api/library/feeds', {
    success: Schema.Struct({ items: Schema.Array(Feed) }),
    error: subscriptionReadErrors,
  }),
  HttpApiEndpoint.post('preview', '/api/library/feeds/preview', {
    payload: urlPayload,
    success: Schema.Struct({ preview: SubscriptionPreview }),
    error: [
      SubscriptionUrlInvalidSchema,
      FetchSubscriptionErrorSchema,
      ParseSubscriptionErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.post('subscribe', '/api/library/feeds', {
    payload: urlPayload,
    success: Schema.Struct({ item: Feed }),
    error: [
      SubscriptionUrlInvalidSchema,
      SubscriptionExistsSchema,
      SubscriptionImportFailedSchema,
      FetchSubscriptionErrorSchema,
      ParseSubscriptionErrorSchema,
      SubscriptionReadErrorSchema,
      SubscriptionWriteErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      SubscriptionNotFoundSchema,
      SubscriptionReadErrorSchema,
      SubscriptionWriteErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.get('laterUnread', '/api/library/later/unread', {
    success: Schema.Struct({ count: Schema.Int }),
    error: [ArticleReadErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('feedsUnread', '/api/library/feeds/unread', {
    success: Schema.Struct({
      total: Schema.Int,
      feeds: Schema.Array(Schema.Struct({ id: FeedId, count: Schema.Int })),
    }),
    error: [ArticleReadErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('article', '/api/library/articles', {
    query: articleId,
    success: Schema.Struct({ item: Schema.NullOr(Article) }),
    error: [ArticleReadErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.post('addArticle', '/api/library/articles', {
    payload: urlPayload,
    success: Schema.Struct({ item: Article }).pipe(HttpApiSchema.status(201)),
    error: [
      InvalidArticleUrlSchema,
      DuplicateArticleSchema,
      ArticleEmptyContentSchema,
      ReaderCredentialsErrorSchema,
      WebpageFetchErrorSchema,
      ArticleExtractErrorSchema,
      ...articleWriteErrors,
    ],
  }),
  HttpApiEndpoint.post('saveArticle', '/api/library/articles/save', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ item: Article }),
    error: [
      ArticleNotFoundSchema,
      ArticleNotInFeedSchema,
      DuplicateArticleSchema,
      ArticleReadErrorSchema,
      ...articleWriteErrors,
    ],
  }),
  HttpApiEndpoint.post('extractArticle', '/api/library/articles/extract', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ item: Article }),
    error: [
      ArticleNotFoundSchema,
      ArticleMissingUrlSchema,
      ArticleEmptyContentSchema,
      ArticleReadErrorSchema,
      ReaderCredentialsErrorSchema,
      WebpageFetchErrorSchema,
      ArticleExtractErrorSchema,
      ...articleWriteErrors,
    ],
  }),
  HttpApiEndpoint.patch('markRead', '/api/library/articles', {
    payload: Schema.Struct({ id: ArticleId, read: Schema.Boolean }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleWriteErrors,
  }),
  HttpApiEndpoint.post('markLater', '/api/library/mark-later', {
    payload: Schema.Struct({}),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleWriteErrors,
  }),
  HttpApiEndpoint.post('markFeeds', '/api/library/mark-feeds', {
    payload: Schema.Struct({
      feedIds: Schema.Array(FeedId).check(Schema.isMaxLength(5000)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleWriteErrors,
  }),
  HttpApiEndpoint.post('markArticles', '/api/library/mark-articles', {
    payload: Schema.Struct({
      ids: Schema.Array(ArticleId).check(Schema.isMaxLength(5000)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleWriteErrors,
  }),
  HttpApiEndpoint.delete('removeArticle', '/api/library/articles', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      ArticleNotLaterSchema,
      ArticleReadErrorSchema,
      ...articleWriteErrors,
    ],
  }),
  HttpApiEndpoint.get('settings', '/api/library/settings', {
    success: ReadingSettings,
    error: [SettingsReadErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.put('setRetention', '/api/library/settings/retention', {
    payload: Schema.Struct({ retention: Schema.Int }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [InvalidRetentionSchema, SettingsSaveErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.put('setExtraction', '/api/library/settings/extraction', {
    payload: Schema.Struct({
      provider: Schema.String,
      jinaKey: Schema.optional(Schema.String),
      browserEndpoint: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      InvalidProviderSchema,
      InvalidKeySchema,
      InvalidEndpointSchema,
      SettingsSaveErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('deleteKey', '/api/library/settings/key', {
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [ExtractionSettingsWriteErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.delete('deleteBrowser', '/api/library/settings/browser', {
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [ExtractionSettingsWriteErrorSchema, ...authErrors],
  })
);

export const LibraryApi = HttpApi.make('library').add(library);
