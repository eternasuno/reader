import {
  articleEmptyContent,
  articleExtractError,
  articleMissingUrl,
  articleNotFound,
  articleNotInFeed,
  articleNotLater,
  articleRepositoryError,
  duplicateArticle,
  feedExists,
  feedNotFound,
  feedRepositoryError,
  feedUrlInvalid,
  fetchFeedError,
  invalidArticleUrl,
  invalidCursor,
  invalidEndpoint,
  invalidKey,
  invalidProvider,
  invalidRetention,
  parseFeedError,
  settingsReadError,
  settingsRepositoryError,
  settingsSaveError,
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
  FeedNotFound: feedNotFound,
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
  HtmlParserError: articleExtractError,
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
  HtmlParserError: articleExtractError,
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

export const extractionFailure = {
  InvalidProvider: invalidProvider,
  InvalidKey: invalidKey,
  InvalidEndpoint: invalidEndpoint,
  SettingsRepositoryError: settingsSaveError,
};
