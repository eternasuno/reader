import {
  articleEmptyContent,
  articleExtractError,
  duplicateSavedPage,
  feedExists,
  feedItemMissingUrl,
  feedItemNotFound,
  feedItemRepositoryError,
  feedNotFound,
  feedRepositoryError,
  feedUrlInvalid,
  fetchFeedError,
  invalidCursor,
  invalidEndpoint,
  invalidKey,
  invalidPageUrl,
  invalidProvider,
  invalidRetention,
  parseFeedError,
  savedPageRepositoryError,
  settingsReadError,
  settingsRepositoryError,
  settingsSaveError,
  webpageFetchError,
} from './library-errors';

export const savedPageFailure = {
  SavedPageRepositoryError: savedPageRepositoryError,
};

export const savedPagePageFailure = {
  InvalidCursor: invalidCursor,
  ...savedPageFailure,
};

export const feedRepositoryFailure = {
  FeedRepositoryError: feedRepositoryError,
};

export const feedItemFailure = {
  FeedItemRepositoryError: feedItemRepositoryError,
  FeedNotFound: feedNotFound,
  ...feedRepositoryFailure,
};

export const feedItemPageFailure = {
  InvalidCursor: invalidCursor,
  ...feedItemFailure,
};

export const settingsRepositoryFailure = {
  SettingsRepositoryError: settingsRepositoryError,
};

const extractionFailure = {
  ArticleEmptyContent: articleEmptyContent,
  ...settingsRepositoryFailure,
  WebpageFetcherError: webpageFetchError,
  ArticleExtractorError: articleExtractError,
  HtmlParserError: articleExtractError,
};

export const addSavedPageFailure = {
  InvalidPageUrl: invalidPageUrl,
  DuplicateSavedPage: duplicateSavedPage,
  ...extractionFailure,
  ...savedPageFailure,
};

export const saveFeedItemFailure = {
  FeedItemNotFound: feedItemNotFound,
  DuplicateSavedPage: duplicateSavedPage,
  ...extractionFailure,
  ...feedItemFailure,
  ...savedPageFailure,
};

export const extractFeedItemFailure = {
  FeedItemNotFound: feedItemNotFound,
  FeedItemMissingUrl: feedItemMissingUrl,
  ...extractionFailure,
  ...feedItemFailure,
};

export const unreadCountsFailure = {
  FeedItemRepositoryError: feedItemRepositoryError,
  ...feedRepositoryFailure,
  ...savedPageFailure,
};

export const markFeedsFailure = {
  FeedItemRepositoryError: feedItemRepositoryError,
  ...feedRepositoryFailure,
};

export const previewFailure = {
  FeedUrlInvalid: feedUrlInvalid,
  FetchFeedError: fetchFeedError,
  FeedParserError: parseFeedError,
};

export const subscribeFailure = {
  FeedUrlInvalid: feedUrlInvalid,
  FeedExists: feedExists,
  FetchFeedError: fetchFeedError,
  FeedParserError: parseFeedError,
  ...feedRepositoryFailure,
};

export const settingsReadFailure = {
  SettingsRepositoryError: settingsReadError,
};

export const retentionFailure = {
  InvalidRetention: invalidRetention,
  SettingsRepositoryError: settingsSaveError,
};

export const extractionSettingsFailure = {
  InvalidProvider: invalidProvider,
  InvalidKey: invalidKey,
  InvalidEndpoint: invalidEndpoint,
  SettingsRepositoryError: settingsSaveError,
};
