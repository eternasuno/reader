import {
  Feed,
  FeedId,
  FeedItem,
  FeedItemId,
  FeedItemList,
  FetcherProvider,
  ReadFilter,
  Retention,
  SavedPage,
  SavedPageId,
  SavedPageList,
  UnreadCounts,
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

const InvalidPageUrlSchema = failure('InvalidPageUrl', 400);

const FeedItemNotFoundSchema = failure('FeedItemNotFound', 404);

const FeedItemMissingUrlSchema = failure('FeedItemMissingUrl', 422);

const ArticleEmptyContentSchema = failure('ArticleEmptyContent', 422);

const DuplicateSavedPageSchema = failure('DuplicateSavedPage', 409);

const InvalidCursorSchema = failure('InvalidCursor', 400);

const FeedItemRepositoryErrorSchema = failure('FeedItemRepositoryError', 500);

const SavedPageRepositoryErrorSchema = failure('SavedPageRepositoryError', 500);

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

const savedPageErrors = [SavedPageRepositoryErrorSchema, ...authErrors];

const feedItemErrors = [
  FeedItemRepositoryErrorSchema,
  FeedNotFoundSchema,
  FeedRepositoryErrorSchema,
  ...authErrors,
];

const savedPageReadErrors = [InvalidCursorSchema, ...savedPageErrors];

const feedItemReadErrors = [InvalidCursorSchema, ...feedItemErrors];

const feedRepositoryErrors = [FeedRepositoryErrorSchema, ...authErrors];

const pageQuery = {
  filter: Schema.OptionFromOptional(ReadFilter),
  cursor: Schema.OptionFromOptional(Schema.String),
  through: Schema.OptionFromOptional(Schema.String),
};

const refreshQuery = {
  filter: Schema.OptionFromOptional(ReadFilter),
  through: Schema.String,
};

const feedItemKey = { feedId: FeedId, id: FeedItemId };

const savedPageKey = { id: SavedPageId };

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
  retention: Retention,
  provider: FetcherProvider,
  browserEndpoint: Schema.OptionFromOptional(Schema.String),
  jinaConfigured: Schema.Boolean,
});

const ok = Schema.Struct({ ok: Schema.Boolean });

const extractionErrors = [
  SettingsRepositoryErrorSchema,
  WebpageFetcherErrorSchema,
  ArticleExtractorErrorSchema,
];

const library = HttpApiGroup.make('library').add(
  HttpApiEndpoint.get('savedPages', '/api/library/saved-pages', {
    query: pageQuery,
    success: SavedPageList,
    error: savedPageReadErrors,
  }),
  HttpApiEndpoint.get('savedPagesRefresh', '/api/library/saved-pages/refresh', {
    query: refreshQuery,
    success: Schema.Struct({ items: Schema.Array(SavedPage) }),
    error: savedPageReadErrors,
  }),
  HttpApiEndpoint.get('savedPage', '/api/library/saved-pages/item', {
    query: savedPageKey,
    success: Schema.Struct({ item: Schema.NullOr(SavedPage) }),
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post('addSavedPage', '/api/library/saved-pages', {
    payload: urlPayload,
    success: Schema.Struct({ item: SavedPage }).pipe(HttpApiSchema.status(201)),
    error: [
      InvalidPageUrlSchema,
      DuplicateSavedPageSchema,
      ArticleEmptyContentSchema,
      ...extractionErrors,
      ...savedPageErrors,
    ],
  }),
  HttpApiEndpoint.post(
    'saveFeedItem',
    '/api/library/saved-pages/from-feed-item',
    {
      payload: Schema.Struct(feedItemKey),
      success: Schema.Struct({ item: SavedPage }),
      error: [
        FeedItemNotFoundSchema,
        DuplicateSavedPageSchema,
        ArticleEmptyContentSchema,
        ...extractionErrors,
        FeedNotFoundSchema,
        FeedRepositoryErrorSchema,
        FeedItemRepositoryErrorSchema,
        ...savedPageErrors,
      ],
    }
  ),
  HttpApiEndpoint.patch('markSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct({ ...savedPageKey, read: Schema.Boolean }),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post('markSavedPages', '/api/library/saved-pages/mark-read', {
    payload: Schema.Struct({
      ids: Schema.Array(SavedPageId).check(Schema.isMaxLength(5000)),
    }),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post(
    'markAllSavedPages',
    '/api/library/saved-pages/mark-all-read',
    {
      payload: Schema.Struct({}),
      success: ok,
      error: savedPageErrors,
    }
  ),
  HttpApiEndpoint.delete('removeSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct(savedPageKey),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.get('feedItems', '/api/library/feeds/items', {
    query: { ...pageQuery, feedId: Schema.OptionFromOptional(FeedId) },
    success: FeedItemList,
    error: feedItemReadErrors,
  }),
  HttpApiEndpoint.get('feedItemsRefresh', '/api/library/feeds/items/refresh', {
    query: { ...refreshQuery, feedId: Schema.OptionFromOptional(FeedId) },
    success: Schema.Struct({ items: Schema.Array(FeedItem) }),
    error: feedItemReadErrors,
  }),
  HttpApiEndpoint.get('feedItem', '/api/library/feeds/items/item', {
    query: feedItemKey,
    success: Schema.Struct({ item: Schema.NullOr(FeedItem) }),
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('extractFeedItem', '/api/library/feeds/items/extract', {
    payload: Schema.Struct(feedItemKey),
    success: Schema.Struct({ item: FeedItem }),
    error: [
      FeedItemNotFoundSchema,
      FeedItemMissingUrlSchema,
      ArticleEmptyContentSchema,
      ...extractionErrors,
      ...feedItemErrors,
    ],
  }),
  HttpApiEndpoint.patch('markFeedItem', '/api/library/feeds/items', {
    payload: Schema.Struct({ ...feedItemKey, read: Schema.Boolean }),
    success: ok,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('markFeedItems', '/api/library/feeds/items/mark-read', {
    payload: Schema.Struct({
      feedId: FeedId,
      ids: Schema.Array(FeedItemId).check(Schema.isMaxLength(5000)),
    }),
    success: ok,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('markFeedsRead', '/api/library/feeds/mark-read', {
    payload: Schema.Struct({
      feedIds: Schema.Array(FeedId).check(Schema.isMaxLength(5000)),
    }),
    success: ok,
    error: [
      FeedItemRepositoryErrorSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
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
    success: ok,
    error: [FeedNotFoundSchema, FeedRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('unreadCounts', '/api/library/unread', {
    success: UnreadCounts,
    error: [
      FeedItemRepositoryErrorSchema,
      SavedPageRepositoryErrorSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.get('settings', '/api/library/settings', {
    success: SettingsResponse,
    error: [SettingsReadErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.put('setRetention', '/api/library/settings/retention', {
    payload: Schema.Struct({ retention: Schema.Int }),
    success: ok,
    error: [InvalidRetentionSchema, SettingsSaveErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.put('setExtraction', '/api/library/settings/extraction', {
    payload: Schema.Struct({
      provider: Schema.String,
      jinaKey: Schema.OptionFromOptional(Schema.String),
      browserEndpoint: Schema.OptionFromOptional(Schema.String),
    }),
    success: ok,
    error: [
      InvalidProviderSchema,
      InvalidKeySchema,
      InvalidEndpointSchema,
      SettingsSaveErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('deleteKey', '/api/library/settings/key', {
    success: ok,
    error: [SettingsRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.delete('deleteBrowser', '/api/library/settings/browser', {
    success: ok,
    error: [SettingsRepositoryErrorSchema, ...authErrors],
  })
);

export const LibraryApi = HttpApi.make('library').add(library);
