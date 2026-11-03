import { Effect, Option } from 'effect';

const failure = <Tag extends string>(tag: Tag, message: string) =>
  Effect.fail({
    _tag: tag,
    message,
    id: Option.none(),
    code: Option.none(),
  } as const);

const identifiedFailure = <Tag extends string>(
  tag: Tag,
  message: string,
  id: string
) =>
  Effect.fail({
    _tag: tag,
    message,
    id: Option.some(id),
    code: Option.none(),
  } as const);

export const invalidCursor = () =>
  failure('InvalidCursor', 'Invalid pagination cursor');

export const articleRepositoryError = () =>
  failure('ArticleRepositoryError', 'Unable to access articles');

export const invalidArticleUrl = () =>
  failure(
    'InvalidArticleUrl',
    'Article URL must use HTTP or HTTPS without credentials'
  );

export const articleNotFound = () =>
  failure('ArticleNotFound', 'Article not found');

export const articleNotInFeed = () =>
  failure('ArticleNotInFeed', 'Article does not belong to a subscription');

export const articleNotLater = () =>
  failure('ArticleNotLater', 'Subscribed articles cannot be deleted');

export const articleMissingUrl = () =>
  failure('ArticleMissingUrl', 'Article has no original URL');

export const articleEmptyContent = () =>
  failure('ArticleEmptyContent', 'Extracted article content is empty');

export const duplicateArticle = (error: { readonly id: string }) =>
  identifiedFailure('DuplicateArticle', 'Article already exists', error.id);

export const settingsRepositoryError = () =>
  failure('SettingsRepositoryError', 'Unable to access extraction settings');

export const webpageFetchError = (error?: { readonly code?: string }) =>
  Effect.fail({
    _tag: 'WebpageFetchError',
    message: 'Unable to fetch the article page',
    id: Option.none(),
    code: Option.fromUndefinedOr(error?.code),
  } as const);

export const articleExtractError = () =>
  failure('ArticleExtractError', 'Unable to extract article content');

export const subscriptionUrlInvalid = () =>
  failure('SubscriptionUrlInvalid', 'Subscription URL must use HTTP or HTTPS');

export const subscriptionExists = (error: { readonly id: string }) =>
  identifiedFailure(
    'SubscriptionExists',
    'Subscription already exists',
    error.id
  );

export const subscriptionNotFound = () =>
  failure('SubscriptionNotFound', 'Subscription not found');

export const subscriptionImportFailed = (error: { readonly id: string }) =>
  identifiedFailure(
    'SubscriptionImportFailed',
    'Failed to import subscription articles',
    error.id
  );

export const fetchSubscriptionError = () =>
  failure('FetchSubscriptionError', 'Unable to fetch the subscription feed');

export const parseSubscriptionError = () =>
  failure('ParseSubscriptionError', 'Unable to parse the subscription feed');

export const feedRepositoryError = () =>
  failure('FeedRepositoryError', 'Unable to access feeds');

export const settingsReadError = () =>
  failure('SettingsReadError', 'Unable to read settings');

export const settingsSaveError = () =>
  failure('SettingsSaveError', 'Unable to save settings');

export const invalidRetention = () =>
  failure(
    'InvalidRetention',
    'Retention must be an integer between 30 and 300'
  );

export const invalidKey = () =>
  failure('InvalidKey', 'Enter a valid Jina API key');

export const invalidEndpoint = () =>
  failure('InvalidEndpoint', 'Enter a valid browser service address');

export const invalidProvider = () =>
  failure('InvalidProvider', 'Choose a valid extraction provider');
