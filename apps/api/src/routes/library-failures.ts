import type { NormalizedUrl } from '@reader/business';
import { Effect } from 'effect';
import {
  articleEmptyContent,
  articleExtractError,
  browserEndpointRequired,
  feedAlreadyExists,
  feedItemNotFound,
  feedItemRepositoryError,
  feedRepositoryError,
  fetchFeedError,
  invalidEndpoint,
  invalidKey,
  invalidProvider,
  invalidRetention,
  parseFeedError,
  savedPageAlreadyExists,
  savedPageRepositoryError,
  settingRepositoryError,
  webpageFetchError,
} from './library-errors';

type Failure = { readonly _tag: string; readonly message: string };

const failed =
  <F extends Failure>(value: () => F) =>
  () =>
    Effect.fail(value());

export const feedRepositoryFailure = {
  FeedRepositoryError: failed(feedRepositoryError),
};

export const feedItemRepositoryFailure = {
  FeedItemRepositoryError: failed(feedItemRepositoryError),
};

export const savedPageRepositoryFailure = {
  SavedPageRepositoryError: failed(savedPageRepositoryError),
};

export const settingRepositoryFailure = {
  SettingRepositoryError: failed(settingRepositoryError),
};

const extractionFailure = {
  ArticleEmptyContent: failed(articleEmptyContent),
  WebpageFetcherError: failed(webpageFetchError),
  ArticleExtractorError: failed(articleExtractError),
  HtmlParserError: failed(articleExtractError),
  ...settingRepositoryFailure,
};

export const previewFailure = {
  FetchFeedError: failed(fetchFeedError),
  FeedParserError: failed(parseFeedError),
};

export const addSavedPageFailure = {
  SavedPageAlreadyExists: (error: { readonly url: NormalizedUrl }) =>
    Effect.fail(savedPageAlreadyExists(error)),
  ...extractionFailure,
  ...savedPageRepositoryFailure,
};

export const saveFeedItemFailure = {
  FeedItemNotFound: (error: { readonly id: string }) =>
    Effect.fail(feedItemNotFound(error)),
  SavedPageAlreadyExists: (error: { readonly url: NormalizedUrl }) =>
    Effect.fail(savedPageAlreadyExists(error)),
  ...extractionFailure,
  ...feedItemRepositoryFailure,
  ...savedPageRepositoryFailure,
};

export const extractFeedItemFailure = {
  FeedItemNotFound: (error: { readonly id: string }) =>
    Effect.fail(feedItemNotFound(error)),
  ...extractionFailure,
  ...feedItemRepositoryFailure,
};

export const subscribeFailure = {
  FeedAlreadyExists: (error: { readonly url: NormalizedUrl }) =>
    Effect.fail(feedAlreadyExists(error)),
  ...feedRepositoryFailure,
};

export const retentionFailure = {
  InvalidRetention: failed(invalidRetention),
  ...settingRepositoryFailure,
};

export const fetcherFailure = {
  InvalidProvider: failed(invalidProvider),
  InvalidKey: failed(invalidKey),
  InvalidEndpoint: failed(invalidEndpoint),
  BrowserEndpointRequired: failed(browserEndpointRequired),
  ...settingRepositoryFailure,
};
