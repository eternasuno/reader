import {
  articleEmptyContent,
  articleExtractError,
  articleMissingUrl,
  articleNotFound,
  articleNotInFeed,
  articleNotLater,
  articleRepositoryError,
  duplicateArticle,
  feedRepositoryError,
  fetchSubscriptionError,
  invalidArticleUrl,
  invalidCursor,
  invalidEndpoint,
  invalidKey,
  invalidProvider,
  invalidRetention,
  parseSubscriptionError,
  settingsReadError,
  settingsRepositoryError,
  settingsSaveError,
  subscriptionExists,
  subscriptionImportFailed,
  subscriptionNotFound,
  subscriptionUrlInvalid,
  webpageFetchError,
} from './library-errors';

export const articleFailure = {
  ArticleRepositoryError: articleRepositoryError,
};

export const articlePageFailure = {
  InvalidCursor: invalidCursor,
  ...articleFailure,
};

export const feedPageFailure = {
  ...articlePageFailure,
  SubscriptionNotFound: subscriptionNotFound,
  FeedRepositoryError: feedRepositoryError,
};

export const settingsRepositoryFailure = {
  SettingsRepositoryError: settingsRepositoryError,
};

export const addFailure = {
  InvalidArticleUrl: invalidArticleUrl,
  ArticleEmptyContent: articleEmptyContent,
  ...settingsRepositoryFailure,
  WebpageFetcherError: webpageFetchError,
  ArticleExtractorError: articleExtractError,
  DuplicateArticle: duplicateArticle,
  ...articleFailure,
};

export const saveFailure = {
  ArticleNotFound: articleNotFound,
  ArticleNotInFeed: articleNotInFeed,
  DuplicateArticle: duplicateArticle,
  ...articleFailure,
};

export const extractFailure = {
  ArticleNotFound: articleNotFound,
  ArticleMissingUrl: articleMissingUrl,
  ArticleEmptyContent: articleEmptyContent,
  ...settingsRepositoryFailure,
  WebpageFetcherError: webpageFetchError,
  ArticleExtractorError: articleExtractError,
  ...articleFailure,
};

export const removeFailure = {
  ArticleNotLater: articleNotLater,
  ...articleFailure,
};

export const feedRepositoryFailure = {
  FeedRepositoryError: feedRepositoryError,
};

export const previewFailure = {
  SubscriptionUrlInvalid: subscriptionUrlInvalid,
  FetchSubscriptionError: fetchSubscriptionError,
  FeedParserError: parseSubscriptionError,
};

export const subscribeFailure = {
  SubscriptionUrlInvalid: subscriptionUrlInvalid,
  SubscriptionExists: subscriptionExists,
  SubscriptionImportFailed: subscriptionImportFailed,
  FetchSubscriptionError: fetchSubscriptionError,
  FeedParserError: parseSubscriptionError,
  ...feedRepositoryFailure,
};

export const settingsReadFailure = {
  SettingsReadError: settingsReadError,
};

export const retentionFailure = {
  InvalidRetention: invalidRetention,
  SettingsSaveError: settingsSaveError,
};

export const extractionFailure = {
  InvalidProvider: invalidProvider,
  InvalidKey: invalidKey,
  InvalidEndpoint: invalidEndpoint,
  SettingsSaveError: settingsSaveError,
};
