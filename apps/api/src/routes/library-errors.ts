import { Effect } from 'effect';

export const invalidCursor = () =>
  Effect.fail({
    _tag: 'InvalidCursor',
    message: 'Invalid pagination cursor',
  } as const);

export const articleReadError = () =>
  Effect.fail({
    _tag: 'ArticleReadError',
    message: 'Unable to read articles',
  } as const);

export const articleWriteError = () =>
  Effect.fail({
    _tag: 'ArticleWriteError',
    message: 'Unable to save articles',
  } as const);

export const invalidArticleUrl = () =>
  Effect.fail({
    _tag: 'InvalidArticleUrl',
    message: 'Article URL must use HTTP or HTTPS without credentials',
  } as const);

export const articleNotFound = () =>
  Effect.fail({
    _tag: 'ArticleNotFound',
    message: 'Article not found',
  } as const);

export const articleNotInFeed = () =>
  Effect.fail({
    _tag: 'ArticleNotInFeed',
    message: 'Article does not belong to a subscription',
  } as const);

export const articleNotLater = () =>
  Effect.fail({
    _tag: 'ArticleNotLater',
    message: 'Subscribed articles cannot be deleted',
  } as const);

export const articleMissingUrl = () =>
  Effect.fail({
    _tag: 'ArticleMissingUrl',
    message: 'Article has no original URL',
  } as const);

export const articleEmptyContent = () =>
  Effect.fail({
    _tag: 'ArticleEmptyContent',
    message: 'Extracted article content is empty',
  } as const);

export const duplicateArticle = (error: { readonly id: string }) =>
  Effect.fail({
    _tag: 'DuplicateArticle',
    message: 'Article already exists',
    id: error.id,
  } as const);

export const settingsRepositoryReadError = () =>
  Effect.fail({
    _tag: 'SettingsRepositoryReadError',
    message: 'Unable to read extraction settings',
  } as const);

export const webpageFetchError = (error?: { readonly code?: string }) =>
  Effect.fail({
    _tag: 'WebpageFetchError',
    message: 'Unable to fetch the article page',
    ...(error?.code === undefined ? {} : { code: error.code }),
  } as const);

export const articleExtractError = () =>
  Effect.fail({
    _tag: 'ArticleExtractError',
    message: 'Unable to extract article content',
  } as const);

export const subscriptionUrlInvalid = () =>
  Effect.fail({
    _tag: 'SubscriptionUrlInvalid',
    message: 'Subscription URL must use HTTP or HTTPS',
  } as const);

export const subscriptionExists = (error: { readonly id: string }) =>
  Effect.fail({
    _tag: 'SubscriptionExists',
    message: 'Subscription already exists',
    id: error.id,
  } as const);

export const subscriptionNotFound = () =>
  Effect.fail({
    _tag: 'SubscriptionNotFound',
    message: 'Subscription not found',
  } as const);

export const subscriptionImportFailed = (error: { readonly id: string }) =>
  Effect.fail({
    _tag: 'SubscriptionImportFailed',
    message: 'Failed to import subscription articles',
    id: error.id,
  } as const);

export const fetchSubscriptionError = () =>
  Effect.fail({
    _tag: 'FetchSubscriptionError',
    message: 'Unable to fetch the subscription feed',
  } as const);

export const parseSubscriptionError = () =>
  Effect.fail({
    _tag: 'ParseSubscriptionError',
    message: 'Unable to parse the subscription feed',
  } as const);

export const subscriptionReadError = () =>
  Effect.fail({
    _tag: 'SubscriptionReadError',
    message: 'Unable to read subscriptions',
  } as const);

export const subscriptionWriteError = () =>
  Effect.fail({
    _tag: 'SubscriptionWriteError',
    message: 'Unable to save subscriptions',
  } as const);

export const settingsReadError = () =>
  Effect.fail({
    _tag: 'SettingsReadError',
    message: 'Unable to read settings',
  } as const);

export const settingsSaveError = () =>
  Effect.fail({
    _tag: 'SettingsSaveError',
    message: 'Unable to save settings',
  } as const);

export const invalidRetention = () =>
  Effect.fail({
    _tag: 'InvalidRetention',
    message: 'Retention must be an integer between 30 and 300',
  } as const);

export const invalidKey = () =>
  Effect.fail({
    _tag: 'InvalidKey',
    message: 'Enter a valid Jina API key',
  } as const);

export const invalidEndpoint = () =>
  Effect.fail({
    _tag: 'InvalidEndpoint',
    message: 'Enter a valid browser service address',
  } as const);

export const invalidProvider = () =>
  Effect.fail({
    _tag: 'InvalidProvider',
    message: 'Choose a valid extraction provider',
  } as const);

export const settingsRepositoryWriteError = () =>
  Effect.fail({
    _tag: 'SettingsRepositoryWriteError',
    message: 'Unable to save extraction settings',
  } as const);
