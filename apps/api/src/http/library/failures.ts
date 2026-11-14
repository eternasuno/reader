import { ApiError } from '@reader/api';
import { Effect } from 'effect';

const withId =
  <E>(make: (id: string) => E) =>
  (error: { readonly id: string }) =>
    Effect.fail(make(error.id));

const withUrl =
  <E>(make: (url: string) => E) =>
  (error: { readonly url: URL }) =>
    Effect.fail(make(error.url.href));

export const feedRepositoryFailure = {
  FeedRepositoryError: () => Effect.fail(new ApiError.FeedRepositoryError()),
};

export const feedItemRepositoryFailure = {
  FeedItemRepositoryError: () =>
    Effect.fail(new ApiError.FeedItemRepositoryError()),
};

export const folderRepositoryFailure = {
  FolderRepositoryError: () =>
    Effect.fail(new ApiError.FolderRepositoryError()),
};

export const savedPageRepositoryFailure = {
  SavedPageRepositoryError: () =>
    Effect.fail(new ApiError.SavedPageRepositoryError()),
};

export const settingRepositoryFailure = {
  SettingRepositoryError: () =>
    Effect.fail(new ApiError.SettingRepositoryError()),
};

const savedPageAlreadyExists = {
  SavedPageAlreadyExists: withUrl(
    (url) => new ApiError.SavedPageAlreadyExists({ url })
  ),
};

const feedItemNotFound = {
  FeedItemNotFound: withId((id) => new ApiError.FeedItemNotFound({ id })),
};

const folderNotFound = {
  FolderNotFound: withId((id) => new ApiError.FolderNotFound({ id })),
};

const folderAlreadyExists = {
  FolderAlreadyExists: () => Effect.fail(new ApiError.FolderAlreadyExists()),
};

const extractionFailure = {
  ArticleEmptyContent: () => Effect.fail(new ApiError.ArticleEmptyContent()),
  WebpageFetcherError: () => Effect.fail(new ApiError.WebpageFetcherError()),
  ArticleExtractorError: () =>
    Effect.fail(new ApiError.ArticleExtractorError()),
  HtmlParserError: () => Effect.fail(new ApiError.ArticleExtractorError()),
  ...settingRepositoryFailure,
};

export const previewFailure = {
  FetchFeedError: () => Effect.fail(new ApiError.FetchFeedError()),
  FeedParserError: () => Effect.fail(new ApiError.FeedParserError()),
};

export const addSavedPageFailure = {
  ...savedPageAlreadyExists,
  ...extractionFailure,
  ...savedPageRepositoryFailure,
};

export const saveFeedItemFailure = {
  ...feedItemNotFound,
  ...savedPageAlreadyExists,
  ...extractionFailure,
  ...feedItemRepositoryFailure,
  ...savedPageRepositoryFailure,
};

export const extractFeedItemFailure = {
  ...feedItemNotFound,
  ...extractionFailure,
  ...feedItemRepositoryFailure,
};

export const subscribeFailure = {
  FeedAlreadyExists: withUrl((url) => new ApiError.FeedAlreadyExists({ url })),
  ...folderNotFound,
  ...feedRepositoryFailure,
  ...folderRepositoryFailure,
};

export const createFolderFailure = {
  ...folderAlreadyExists,
  ...folderRepositoryFailure,
};

export const renameFolderFailure = {
  ...folderAlreadyExists,
  ...folderNotFound,
  ...folderRepositoryFailure,
};

export const moveFeedFailure = {
  ...folderNotFound,
  ...feedRepositoryFailure,
  ...folderRepositoryFailure,
};

export const browserFetcherFailure = {
  BrowserEndpointRequired: () =>
    Effect.fail(new ApiError.BrowserEndpointRequired()),
  ...settingRepositoryFailure,
};
