import { FeedItemId, FolderId } from '@reader/business';
import { Schema } from 'effect';

/**
 * The contract errors. The tag is the class name, the HTTP status is an
 * annotation and the response body is encoded from the class itself, so nothing
 * writes `_tag` by hand (reader-engineering: Server > Errors).
 *
 * A well formed value that breaks a domain value rule answers 400 with the
 * domain tag; every other failure carries only its tag, plus `id` or `url`
 * where the domain API table says so, and no message (reader-spec: API
 * conventions).
 */

declare const brand: unique symbol;

/**
 * Makes each error class a nominal type, so a structurally identical value is
 * not accepted where the class is expected (Effect language service
 * `schemaClassMissingBrand`).
 */
type ContractErrorBrand = { readonly brand: typeof brand };

// --- input value rules: 400 with the domain tag -------------------------------

/** The address is not a usable `http`/`https` URL (later.md, CM-URL-1). */
export class InvalidPageUrl extends Schema.TaggedError<
  InvalidPageUrl,
  ContractErrorBrand
>()('InvalidPageUrl', {}, { httpApiStatus: 400 }) {}

/** The address is not a usable `http`/`https` URL (feeds.md, CM-URL-1). */
export class FeedUrlInvalid extends Schema.TaggedError<
  FeedUrlInvalid,
  ContractErrorBrand
>()('FeedUrlInvalid', {}, { httpApiStatus: 400 }) {}

/** The folder name is blank after trimming (folders.md, FD-FOLDER-2). */
export class InvalidFolderName extends Schema.TaggedError<
  InvalidFolderName,
  ContractErrorBrand
>()('InvalidFolderName', {}, { httpApiStatus: 400 }) {}

/** Retention is zero, negative or not an integer (settings.md, SET-VAL-1). */
export class InvalidRetention extends Schema.TaggedError<
  InvalidRetention,
  ContractErrorBrand
>()('InvalidRetention', {}, { httpApiStatus: 400 }) {}

/** The browser endpoint is not an http, https, ws or wss URL (SET-VAL-3). */
export class InvalidEndpoint extends Schema.TaggedError<
  InvalidEndpoint,
  ContractErrorBrand
>()('InvalidEndpoint', {}, { httpApiStatus: 400 }) {}

// --- missing rows: 404 with the id -------------------------------------------

/** The item does not exist for the owner (feeds.md, FD-EXTRACT step 1). */
export class FeedItemNotFound extends Schema.TaggedError<
  FeedItemNotFound,
  ContractErrorBrand
>()('FeedItemNotFound', { id: FeedItemId }, { httpApiStatus: 404 }) {}

/** The folder does not exist for the owner (folders.md, FD-FOLDER-5). */
export class FolderNotFound extends Schema.TaggedError<
  FolderNotFound,
  ContractErrorBrand
>()('FolderNotFound', { id: FolderId }, { httpApiStatus: 404 }) {}

// --- duplicate keys: 409 -----------------------------------------------------

/** The owner already saved this URL; it carries the key (later.md, SP-ADD-5). */
export class SavedPageAlreadyExists extends Schema.TaggedError<
  SavedPageAlreadyExists,
  ContractErrorBrand
>()('SavedPageAlreadyExists', { url: Schema.String }, { httpApiStatus: 409 }) {}

/** The owner already follows this URL; it carries the key (feeds.md, FD-SUB-2). */
export class FeedAlreadyExists extends Schema.TaggedError<
  FeedAlreadyExists,
  ContractErrorBrand
>()('FeedAlreadyExists', { url: Schema.String }, { httpApiStatus: 409 }) {}

/**
 * The owner already has a folder of this name. It carries nothing, because the
 * client knows the name it sent (folders.md, CM-ID-6).
 */
export class FolderAlreadyExists extends Schema.TaggedError<
  FolderAlreadyExists,
  ContractErrorBrand
>()('FolderAlreadyExists', {}, { httpApiStatus: 409 }) {}

// --- extraction and fetching: 422 (CM-FETCH-4) -------------------------------

/** Nothing was extracted: the sanitized content is blank (CM-ART-5). */
export class ArticleEmptyContent extends Schema.TaggedError<
  ArticleEmptyContent,
  ContractErrorBrand
>()('ArticleEmptyContent', {}, { httpApiStatus: 422 }) {}

/** The page could not be fetched (CM-FETCH-4). */
export class WebpageFetcherError extends Schema.TaggedError<
  WebpageFetcherError,
  ContractErrorBrand
>()('WebpageFetcherError', {}, { httpApiStatus: 422 }) {}

/** The article could not be extracted, including a page that cannot be parsed. */
export class ArticleExtractorError extends Schema.TaggedError<
  ArticleExtractorError,
  ContractErrorBrand
>()('ArticleExtractorError', {}, { httpApiStatus: 422 }) {}

/** The source could not be fetched (feeds.md, FD-FETCH-2). */
export class FetchFeedError extends Schema.TaggedError<
  FetchFeedError,
  ContractErrorBrand
>()('FetchFeedError', {}, { httpApiStatus: 422 }) {}

/** The source is not RSS, Atom, RDF or JSON Feed (FD-PARSE-1). */
export class FeedParserError extends Schema.TaggedError<
  FeedParserError,
  ContractErrorBrand
>()('FeedParserError', {}, { httpApiStatus: 422 }) {}

/** No endpoint was given and none is stored (settings.md, SET-FETCH-3). */
export class BrowserEndpointRequired extends Schema.TaggedError<
  BrowserEndpointRequired,
  ContractErrorBrand
>()('BrowserEndpointRequired', {}, { httpApiStatus: 422 }) {}

// --- storage and the auth service: 500 ---------------------------------------

/** The `FeedItemRepository` failed, so no feed item data is available. */
export class FeedItemRepositoryError extends Schema.TaggedError<
  FeedItemRepositoryError,
  ContractErrorBrand
>()('FeedItemRepositoryError', {}, { httpApiStatus: 500 }) {}

/** The `FeedRepository` failed, so no feed data is available. */
export class FeedRepositoryError extends Schema.TaggedError<
  FeedRepositoryError,
  ContractErrorBrand
>()('FeedRepositoryError', {}, { httpApiStatus: 500 }) {}

/** The `FolderRepository` failed, so no folder data is available. */
export class FolderRepositoryError extends Schema.TaggedError<
  FolderRepositoryError,
  ContractErrorBrand
>()('FolderRepositoryError', {}, { httpApiStatus: 500 }) {}

/** The `SavedPageRepository` failed, so no saved-page data is available. */
export class SavedPageRepositoryError extends Schema.TaggedError<
  SavedPageRepositoryError,
  ContractErrorBrand
>()('SavedPageRepositoryError', {}, { httpApiStatus: 500 }) {}

/** The `SettingRepository` failed, so no settings are available. */
export class SettingRepositoryError extends Schema.TaggedError<
  SettingRepositoryError,
  ContractErrorBrand
>()('SettingRepositoryError', {}, { httpApiStatus: 500 }) {}

/** Better Auth's session check itself failed (SKILL.md API conventions). */
export class AuthUnavailable extends Schema.TaggedError<
  AuthUnavailable,
  ContractErrorBrand
>()('AuthUnavailable', {}, { httpApiStatus: 500 }) {}
