import { Effect } from 'effect';

const tagged =
  <Tag extends string>(tag: Tag) =>
  () =>
    Effect.fail({ _tag: tag } as const);

const withId =
  <Tag extends string>(tag: Tag) =>
  (error: { readonly id: string }) =>
    Effect.fail({ _tag: tag, id: error.id } as const);

const withUrl =
  <Tag extends string>(tag: Tag) =>
  (error: { readonly url: URL }) =>
    Effect.fail({ _tag: tag, url: error.url.href } as const);

export const feedRepositoryFailure = {
  FeedRepositoryError: tagged('FeedRepositoryError'),
};

export const feedItemRepositoryFailure = {
  FeedItemRepositoryError: tagged('FeedItemRepositoryError'),
};

export const folderRepositoryFailure = {
  FolderRepositoryError: tagged('FolderRepositoryError'),
};

export const savedPageRepositoryFailure = {
  SavedPageRepositoryError: tagged('SavedPageRepositoryError'),
};

export const settingRepositoryFailure = {
  SettingRepositoryError: tagged('SettingRepositoryError'),
};

const extractionFailure = {
  ArticleEmptyContent: tagged('ArticleEmptyContent'),
  WebpageFetcherError: tagged('WebpageFetcherError'),
  ArticleExtractorError: tagged('ArticleExtractorError'),
  HtmlParserError: tagged('ArticleExtractorError'),
  ...settingRepositoryFailure,
};

export const previewFailure = {
  FetchFeedError: tagged('FetchFeedError'),
  FeedParserError: tagged('FeedParserError'),
};

export const addSavedPageFailure = {
  SavedPageAlreadyExists: withUrl('SavedPageAlreadyExists'),
  ...extractionFailure,
  ...savedPageRepositoryFailure,
};

export const saveFeedItemFailure = {
  FeedItemNotFound: withId('FeedItemNotFound'),
  SavedPageAlreadyExists: withUrl('SavedPageAlreadyExists'),
  ...extractionFailure,
  ...feedItemRepositoryFailure,
  ...savedPageRepositoryFailure,
};

export const extractFeedItemFailure = {
  FeedItemNotFound: withId('FeedItemNotFound'),
  ...extractionFailure,
  ...feedItemRepositoryFailure,
};

export const subscribeFailure = {
  FeedAlreadyExists: withUrl('FeedAlreadyExists'),
  FolderNotFound: withId('FolderNotFound'),
  ...feedRepositoryFailure,
  ...folderRepositoryFailure,
};

export const createFolderFailure = {
  FolderAlreadyExists: tagged('FolderAlreadyExists'),
  ...folderRepositoryFailure,
};

export const renameFolderFailure = {
  FolderAlreadyExists: tagged('FolderAlreadyExists'),
  FolderNotFound: withId('FolderNotFound'),
  ...folderRepositoryFailure,
};

export const moveFeedFailure = {
  FolderNotFound: withId('FolderNotFound'),
  ...feedRepositoryFailure,
  ...folderRepositoryFailure,
};

export const retentionFailure = {
  InvalidRetention: tagged('InvalidRetention'),
  ...settingRepositoryFailure,
};

export const jinaFetcherFailure = {
  InvalidKey: tagged('InvalidKey'),
  ...settingRepositoryFailure,
};

export const browserFetcherFailure = {
  InvalidEndpoint: tagged('InvalidEndpoint'),
  BrowserEndpointRequired: tagged('BrowserEndpointRequired'),
  ...settingRepositoryFailure,
};
