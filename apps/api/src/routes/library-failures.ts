import {
  articleEmptyContent,
  articleExtractError,
  articleMissingUrl,
  articleNotFound,
  articleNotInFeed,
  articleNotLater,
  articleReadError,
  articleWriteError,
  duplicateArticle,
  extractionSettingsWriteError,
  fetchSubscriptionError,
  invalidArticleUrl,
  invalidCursor,
  invalidEndpoint,
  invalidKey,
  invalidProvider,
  invalidRetention,
  parseSubscriptionError,
  readerCredentialsError,
  settingsReadError,
  settingsSaveError,
  subscriptionExists,
  subscriptionImportFailed,
  subscriptionNotFound,
  subscriptionReadError,
  subscriptionUrlInvalid,
  subscriptionWriteError,
  webpageFetchError,
} from './library-errors';

export const articleReadFailure = {
  ArticleReadError: articleReadError,
};

export const articlePageFailure = {
  InvalidCursor: invalidCursor,
  ...articleReadFailure,
};

export const feedPageFailure = {
  ...articlePageFailure,
  SubscriptionNotFound: subscriptionNotFound,
  SubscriptionReadError: subscriptionReadError,
};

export const articleWriteFailure = {
  ArticleWriteError: articleWriteError,
};

export const addFailure = {
  InvalidArticleUrl: invalidArticleUrl,
  ArticleEmptyContent: articleEmptyContent,
  ReaderCredentialsError: readerCredentialsError,
  WebpageFetchError: webpageFetchError,
  ArticleExtractError: articleExtractError,
  DuplicateArticle: duplicateArticle,
  ...articleWriteFailure,
};

export const saveFailure = {
  ArticleNotFound: articleNotFound,
  ArticleNotInFeed: articleNotInFeed,
  DuplicateArticle: duplicateArticle,
  ...articleReadFailure,
  ...articleWriteFailure,
};

export const extractFailure = {
  ArticleNotFound: articleNotFound,
  ArticleMissingUrl: articleMissingUrl,
  ArticleEmptyContent: articleEmptyContent,
  ReaderCredentialsError: readerCredentialsError,
  WebpageFetchError: webpageFetchError,
  ArticleExtractError: articleExtractError,
  ...articleReadFailure,
  ...articleWriteFailure,
};

export const removeFailure = {
  ArticleNotLater: articleNotLater,
  ...articleReadFailure,
  ...articleWriteFailure,
};

export const subscriptionReadFailure = {
  SubscriptionReadError: subscriptionReadError,
};

export const subscriptionWriteFailure = {
  SubscriptionWriteError: subscriptionWriteError,
};

export const previewFailure = {
  SubscriptionUrlInvalid: subscriptionUrlInvalid,
  FetchSubscriptionError: fetchSubscriptionError,
  ParseSubscriptionError: parseSubscriptionError,
};

export const subscribeFailure = {
  SubscriptionUrlInvalid: subscriptionUrlInvalid,
  SubscriptionExists: subscriptionExists,
  SubscriptionImportFailed: subscriptionImportFailed,
  FetchSubscriptionError: fetchSubscriptionError,
  ParseSubscriptionError: parseSubscriptionError,
  ...subscriptionReadFailure,
  ...subscriptionWriteFailure,
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

export const extractionWriteFailure = {
  ExtractionSettingsWriteError: extractionSettingsWriteError,
};
