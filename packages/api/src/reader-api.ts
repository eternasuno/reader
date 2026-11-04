import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import { Article, ArticleId } from '../../business/src/entity/article.ts';
import { Feed } from '../../business/src/entity/feed.ts';
import { FeedId } from '../../business/src/entity/object-value.ts';
import { Setting } from '../../business/src/entity/setting.ts';
import {
  ArticleFilter,
  ArticleUnreadCounts,
} from '../../business/src/port/article-repository.ts';
import { ArticlePage } from '../../business/src/usecase/article-list.ts';

const failure = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.Literal(tag),
    message: Schema.String,
    id: Schema.OptionFromOptional(Schema.String),
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
export const ArticleRepositoryErrorSchema = failure(
  'ArticleRepositoryError',
  500
);
export const WebpageFetcherErrorSchema = failure('WebpageFetcherError', 422);
export const ArticleExtractorErrorSchema = failure(
  'ArticleExtractorError',
  422
);

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
export const FeedParserErrorSchema = failure('FeedParserError', 422);
export const FeedRepositoryErrorSchema = failure('FeedRepositoryError', 500);

export const SettingsReadErrorSchema = failure('SettingsReadError', 500);
export const SettingsSaveErrorSchema = failure('SettingsSaveError', 500);
export const InvalidRetentionSchema = failure('InvalidRetention', 400);
export const InvalidKeySchema = failure('InvalidKey', 400);
export const InvalidEndpointSchema = failure('InvalidEndpoint', 400);
export const InvalidProviderSchema = failure('InvalidProvider', 400);
export const SettingsRepositoryErrorSchema = failure(
  'SettingsRepositoryError',
  500
);

const authErrors = [UnauthorizedSchema, ForbiddenSchema];

const articleErrors = [ArticleRepositoryErrorSchema, ...authErrors];

const readErrors = [InvalidCursorSchema, ...articleErrors];

const feedRepositoryErrors = [FeedRepositoryErrorSchema, ...authErrors];

const pageQuery = {
  filter: Schema.OptionFromOptional(ArticleFilter),
  cursor: Schema.OptionFromOptional(Schema.String),
  through: Schema.OptionFromOptional(Schema.String),
};

const refreshQuery = {
  filter: Schema.OptionFromOptional(ArticleFilter),
  through: Schema.String,
};

const articleId = { id: ArticleId };

const urlPayload = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(4096)),
});

const SubscriptionPreview = Schema.Struct({
  url: Schema.URLFromString,
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  titles: Schema.Array(Schema.String),
});

const SettingsResponse = Schema.Struct({
  retention: Setting.fields.retention,
  provider: Setting.fields.provider,
  browserEndpoint: Setting.fields.browserEndpoint,
  jinaConfigured: Schema.Boolean,
});

const library = HttpApiGroup.make('library').add(
  HttpApiEndpoint.get('laterList', '/api/library/later', {
    query: pageQuery,
    success: ArticlePage,
    error: readErrors,
  }),
  HttpApiEndpoint.get('feedArticles', '/api/library/feeds/articles', {
    query: { ...pageQuery, feedId: Schema.OptionFromOptional(FeedId) },
    success: ArticlePage,
    error: [
      ...readErrors,
      SubscriptionNotFoundSchema,
      FeedRepositoryErrorSchema,
    ],
  }),
  HttpApiEndpoint.get('laterRefresh', '/api/library/later/refresh', {
    query: refreshQuery,
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: readErrors,
  }),
  HttpApiEndpoint.get('feedRefresh', '/api/library/feeds/refresh', {
    query: { ...refreshQuery, feedId: Schema.OptionFromOptional(FeedId) },
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: [
      ...readErrors,
      SubscriptionNotFoundSchema,
      FeedRepositoryErrorSchema,
    ],
  }),
  HttpApiEndpoint.get('feeds', '/api/library/feeds', {
    success: Schema.Struct({ items: Schema.Array(Feed) }),
    error: feedRepositoryErrors,
  }),
  HttpApiEndpoint.post('preview', '/api/library/feeds/preview', {
    payload: urlPayload,
    success: Schema.Struct({ preview: SubscriptionPreview }),
    error: [
      SubscriptionUrlInvalidSchema,
      FetchSubscriptionErrorSchema,
      FeedParserErrorSchema,
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
      FeedParserErrorSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      SubscriptionNotFoundSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.get('unreadCounts', '/api/library/unread', {
    success: ArticleUnreadCounts,
    error: [ArticleRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('article', '/api/library/articles', {
    query: articleId,
    success: Schema.Struct({ item: Schema.NullOr(Article) }),
    error: [ArticleRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.post('addArticle', '/api/library/articles', {
    payload: urlPayload,
    success: Schema.Struct({ item: Article }).pipe(HttpApiSchema.status(201)),
    error: [
      InvalidArticleUrlSchema,
      DuplicateArticleSchema,
      ArticleEmptyContentSchema,
      SettingsRepositoryErrorSchema,
      WebpageFetcherErrorSchema,
      ArticleExtractorErrorSchema,
      ...articleErrors,
    ],
  }),
  HttpApiEndpoint.post('saveArticle', '/api/library/articles/save', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ item: Article }),
    error: [
      ArticleNotFoundSchema,
      ArticleNotInFeedSchema,
      DuplicateArticleSchema,
      ArticleRepositoryErrorSchema,
      ...articleErrors,
    ],
  }),
  HttpApiEndpoint.post('extractArticle', '/api/library/articles/extract', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ item: Article }),
    error: [
      ArticleNotFoundSchema,
      ArticleMissingUrlSchema,
      ArticleEmptyContentSchema,
      ArticleRepositoryErrorSchema,
      SettingsRepositoryErrorSchema,
      WebpageFetcherErrorSchema,
      ArticleExtractorErrorSchema,
      ...articleErrors,
    ],
  }),
  HttpApiEndpoint.patch('markRead', '/api/library/articles', {
    payload: Schema.Struct({ id: ArticleId, read: Schema.Boolean }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.post('markLater', '/api/library/mark-later', {
    payload: Schema.Struct({}),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.post('markFeeds', '/api/library/mark-feeds', {
    payload: Schema.Struct({
      feedIds: Schema.Array(FeedId).check(Schema.isMaxLength(5000)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.post('markArticles', '/api/library/mark-articles', {
    payload: Schema.Struct({
      ids: Schema.Array(ArticleId).check(Schema.isMaxLength(5000)),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: articleErrors,
  }),
  HttpApiEndpoint.delete('removeArticle', '/api/library/articles', {
    payload: Schema.Struct(articleId),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [
      ArticleNotLaterSchema,
      ArticleRepositoryErrorSchema,
      ...articleErrors,
    ],
  }),
  HttpApiEndpoint.get('settings', '/api/library/settings', {
    success: SettingsResponse,
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
      jinaKey: Schema.OptionFromOptional(Schema.String),
      browserEndpoint: Schema.OptionFromOptional(Schema.String),
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
    error: [SettingsRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.delete('deleteBrowser', '/api/library/settings/browser', {
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [SettingsRepositoryErrorSchema, ...authErrors],
  })
);

export const LibraryApi = HttpApi.make('library').add(library);
