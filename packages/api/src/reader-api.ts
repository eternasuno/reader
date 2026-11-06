import {
  Article,
  ArticleFilter,
  ArticleId,
  ArticlePage,
  ArticleUnreadCounts,
  Feed,
  FeedId,
  Setting,
} from '@reader/business';
import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';

const failure = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.Literal(tag),
    message: Schema.String,
    id: Schema.OptionFromOptional(Schema.String),
  }).pipe(HttpApiSchema.status(status));

const UnauthorizedSchema = Schema.Struct({
  error: Schema.Literal('Unauthorized'),
}).pipe(HttpApiSchema.status(401));

const ForbiddenSchema = Schema.Struct({
  error: Schema.Literal('Cross-site modification is not allowed'),
}).pipe(HttpApiSchema.status(403));

const InvalidArticleUrlSchema = failure('InvalidArticleUrl', 400);

const ArticleNotFoundSchema = failure('ArticleNotFound', 404);

const ArticleNotInFeedSchema = failure('ArticleNotInFeed', 409);

const ArticleNotLaterSchema = failure('ArticleNotLater', 409);

const ArticleMissingUrlSchema = failure('ArticleMissingUrl', 422);

const ArticleEmptyContentSchema = failure('ArticleEmptyContent', 422);

const DuplicateArticleSchema = failure('DuplicateArticle', 409);

const InvalidCursorSchema = failure('InvalidCursor', 400);

const ArticleRepositoryErrorSchema = failure('ArticleRepositoryError', 500);

const WebpageFetcherErrorSchema = failure('WebpageFetcherError', 422);

const ArticleExtractorErrorSchema = failure('ArticleExtractorError', 422);

const FeedUrlInvalidSchema = failure('FeedUrlInvalid', 400);

const FeedExistsSchema = failure('FeedExists', 409);

const FeedNotFoundSchema = failure('FeedNotFound', 404);

const FeedImportFailedSchema = failure('FeedImportFailed', 422);

const FetchFeedErrorSchema = failure('FetchFeedError', 422);

const FeedParserErrorSchema = failure('FeedParserError', 422);

const FeedRepositoryErrorSchema = failure('FeedRepositoryError', 500);

const SettingsReadErrorSchema = failure('SettingsReadError', 500);

const SettingsSaveErrorSchema = failure('SettingsSaveError', 500);

const InvalidRetentionSchema = failure('InvalidRetention', 400);

const InvalidKeySchema = failure('InvalidKey', 400);

const InvalidEndpointSchema = failure('InvalidEndpoint', 400);

const InvalidProviderSchema = failure('InvalidProvider', 400);

const SettingsRepositoryErrorSchema = failure('SettingsRepositoryError', 500);

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

const FeedPreview = Schema.Struct({
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
    error: [...readErrors, FeedNotFoundSchema, FeedRepositoryErrorSchema],
  }),
  HttpApiEndpoint.get('laterRefresh', '/api/library/later/refresh', {
    query: refreshQuery,
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: readErrors,
  }),
  HttpApiEndpoint.get('feedRefresh', '/api/library/feeds/refresh', {
    query: { ...refreshQuery, feedId: Schema.OptionFromOptional(FeedId) },
    success: Schema.Struct({ items: Schema.Array(Article) }),
    error: [...readErrors, FeedNotFoundSchema, FeedRepositoryErrorSchema],
  }),
  HttpApiEndpoint.get('feeds', '/api/library/feeds', {
    success: Schema.Struct({ items: Schema.Array(Feed) }),
    error: feedRepositoryErrors,
  }),
  HttpApiEndpoint.post('preview', '/api/library/feeds/preview', {
    payload: urlPayload,
    success: Schema.Struct({ preview: FeedPreview }),
    error: [
      FeedUrlInvalidSchema,
      FetchFeedErrorSchema,
      FeedParserErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.post('subscribe', '/api/library/feeds', {
    payload: urlPayload,
    success: Schema.Struct({ item: Feed }),
    error: [
      FeedUrlInvalidSchema,
      FeedExistsSchema,
      FeedImportFailedSchema,
      FetchFeedErrorSchema,
      FeedParserErrorSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: [FeedNotFoundSchema, FeedRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('unreadCounts', '/api/library/unread', {
    success: ArticleUnreadCounts,
    error: articleErrors,
  }),
  HttpApiEndpoint.get('article', '/api/library/articles', {
    query: articleId,
    success: Schema.Struct({ item: Schema.NullOr(Article) }),
    error: articleErrors,
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
    error: [ArticleNotLaterSchema, ...articleErrors],
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
