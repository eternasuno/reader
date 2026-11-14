import { Schema } from 'effect';

/**
 * Errors declared by the library contract. Their tag is the class name, their
 * HTTP status comes from the `httpApiStatus` annotation, and the runtime encodes
 * the response body from the same schema.
 */
export class InvalidPageUrl extends Schema.TaggedError<InvalidPageUrl>()(
  'InvalidPageUrl',
  {},
  { httpApiStatus: 400 }
) {}

export class FeedUrlInvalid extends Schema.TaggedError<FeedUrlInvalid>()(
  'FeedUrlInvalid',
  {},
  { httpApiStatus: 400 }
) {}

export class InvalidRetention extends Schema.TaggedError<InvalidRetention>()(
  'InvalidRetention',
  {},
  { httpApiStatus: 400 }
) {}

export class InvalidEndpoint extends Schema.TaggedError<InvalidEndpoint>()(
  'InvalidEndpoint',
  {},
  { httpApiStatus: 400 }
) {}

export class InvalidFolderName extends Schema.TaggedError<InvalidFolderName>()(
  'InvalidFolderName',
  {},
  { httpApiStatus: 400 }
) {}

export class FeedItemNotFound extends Schema.TaggedError<FeedItemNotFound>()(
  'FeedItemNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 }
) {}

export class FolderNotFound extends Schema.TaggedError<FolderNotFound>()(
  'FolderNotFound',
  { id: Schema.String },
  { httpApiStatus: 404 }
) {}

export class SavedPageAlreadyExists extends Schema.TaggedError<SavedPageAlreadyExists>()(
  'SavedPageAlreadyExists',
  { url: Schema.String },
  { httpApiStatus: 409 }
) {}

export class FeedAlreadyExists extends Schema.TaggedError<FeedAlreadyExists>()(
  'FeedAlreadyExists',
  { url: Schema.String },
  { httpApiStatus: 409 }
) {}

export class FolderAlreadyExists extends Schema.TaggedError<FolderAlreadyExists>()(
  'FolderAlreadyExists',
  {},
  { httpApiStatus: 409 }
) {}

export class ArticleEmptyContent extends Schema.TaggedError<ArticleEmptyContent>()(
  'ArticleEmptyContent',
  {},
  { httpApiStatus: 422 }
) {}

export class WebpageFetcherError extends Schema.TaggedError<WebpageFetcherError>()(
  'WebpageFetcherError',
  {},
  { httpApiStatus: 422 }
) {}

export class ArticleExtractorError extends Schema.TaggedError<ArticleExtractorError>()(
  'ArticleExtractorError',
  {},
  { httpApiStatus: 422 }
) {}

export class FetchFeedError extends Schema.TaggedError<FetchFeedError>()(
  'FetchFeedError',
  {},
  { httpApiStatus: 422 }
) {}

export class FeedParserError extends Schema.TaggedError<FeedParserError>()(
  'FeedParserError',
  {},
  { httpApiStatus: 422 }
) {}

export class BrowserEndpointRequired extends Schema.TaggedError<BrowserEndpointRequired>()(
  'BrowserEndpointRequired',
  {},
  { httpApiStatus: 422 }
) {}

export class FeedItemRepositoryError extends Schema.TaggedError<FeedItemRepositoryError>()(
  'FeedItemRepositoryError',
  {},
  { httpApiStatus: 500 }
) {}

export class FeedRepositoryError extends Schema.TaggedError<FeedRepositoryError>()(
  'FeedRepositoryError',
  {},
  { httpApiStatus: 500 }
) {}

export class FolderRepositoryError extends Schema.TaggedError<FolderRepositoryError>()(
  'FolderRepositoryError',
  {},
  { httpApiStatus: 500 }
) {}

export class SavedPageRepositoryError extends Schema.TaggedError<SavedPageRepositoryError>()(
  'SavedPageRepositoryError',
  {},
  { httpApiStatus: 500 }
) {}

export class SettingRepositoryError extends Schema.TaggedError<SettingRepositoryError>()(
  'SettingRepositoryError',
  {},
  { httpApiStatus: 500 }
) {}

export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable>()(
  'AuthUnavailable',
  {},
  { httpApiStatus: 500 }
) {}
