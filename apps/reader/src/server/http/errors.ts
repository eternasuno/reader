import type * as Business from '@reader/business';
import { Effect } from 'effect';
import * as Api from '../../contract';

/**
 * The failures the business layer raises to a handler (reader-spec: API
 * conventions). `DocumentSanitizerError` is absent because only the refresh
 * sanitizes text and no endpoint declares it: it never reaches an HTTP handler.
 */
export type BusinessError =
  | Business.ArticleEmptyContent
  | Business.ArticleExtractorError
  | Business.BrowserEndpointRequired
  | Business.FeedAlreadyExists
  | Business.FeedItemNotFound
  | Business.FeedItemRepositoryError
  | Business.FeedParserError
  | Business.FeedRepositoryError
  | Business.FetchFeedError
  | Business.FolderAlreadyExists
  | Business.FolderNotFound
  | Business.FolderRepositoryError
  | Business.HtmlParserError
  | Business.SavedPageAlreadyExists
  | Business.SavedPageRepositoryError
  | Business.SettingRepositoryError
  | Business.WebpageFetcherError;

/** Every contract error a handler may answer (contract/errors.ts). */
export type ContractError =
  | Api.ArticleEmptyContent
  | Api.ArticleExtractorError
  | Api.BrowserEndpointRequired
  | Api.FeedAlreadyExists
  | Api.FeedItemNotFound
  | Api.FeedItemRepositoryError
  | Api.FeedParserError
  | Api.FeedRepositoryError
  | Api.FetchFeedError
  | Api.FolderAlreadyExists
  | Api.FolderNotFound
  | Api.FolderRepositoryError
  | Api.InvalidEndpoint
  | Api.InvalidFolderName
  | Api.InvalidPageUrl
  | Api.InvalidRetention
  | Api.SavedPageAlreadyExists
  | Api.SavedPageRepositoryError
  | Api.SettingRepositoryError
  | Api.WebpageFetcherError;

/**
 * One entry per business tag, each building the contract error that tag
 * answers: the 400 domain tags, 404, 409, 422 and 500 (reader-spec: API
 * conventions). `HtmlParserError` answers `ArticleExtractorError`, because
 * CM-FETCH-4 has no contract tag for a page that cannot be parsed.
 */
const table = {
  ArticleEmptyContent: () => new Api.ArticleEmptyContent(),
  ArticleExtractorError: () => new Api.ArticleExtractorError(),
  BrowserEndpointRequired: () => new Api.BrowserEndpointRequired(),
  FeedAlreadyExists: (error) =>
    new Api.FeedAlreadyExists({ url: error.url.href }),
  FeedItemNotFound: (error) => new Api.FeedItemNotFound({ id: error.id }),
  FeedItemRepositoryError: () => new Api.FeedItemRepositoryError(),
  FeedParserError: () => new Api.FeedParserError(),
  FeedRepositoryError: () => new Api.FeedRepositoryError(),
  FetchFeedError: () => new Api.FetchFeedError(),
  FolderAlreadyExists: () => new Api.FolderAlreadyExists(),
  FolderNotFound: (error) => new Api.FolderNotFound({ id: error.id }),
  FolderRepositoryError: () => new Api.FolderRepositoryError(),
  HtmlParserError: () => new Api.ArticleExtractorError(),
  SavedPageAlreadyExists: (error) =>
    new Api.SavedPageAlreadyExists({ url: error.url.href }),
  SavedPageRepositoryError: () => new Api.SavedPageRepositoryError(),
  SettingRepositoryError: () => new Api.SettingRepositoryError(),
  WebpageFetcherError: () => new Api.WebpageFetcherError(),
} satisfies {
  readonly [Tag in BusinessError['_tag']]: (
    error: Extract<BusinessError, { readonly _tag: Tag }>
  ) => ContractError;
};

/** The contract error a business error maps to, per tag (distributive). */
export type Mapped<E> = E extends { readonly _tag: keyof typeof table }
  ? ReturnType<(typeof table)[E['_tag']]>
  : never;

/**
 * Maps one business failure through the table. The cast is only about the
 * union-typed `_tag`: `satisfies` above already checked every entry against
 * its own business error.
 */
export const toContractError = <E extends BusinessError>(error: E): Mapped<E> =>
  (table[error._tag] as unknown as (error: E) => Mapped<E>)(error);

/**
 * Runs a handler's business call for the session's owner (CM-OWN-1) and maps
 * its failures through the table. A business error without an entry does not
 * typecheck, so no handler can answer an unmapped tag.
 */
export const handle = <A, E extends BusinessError, R>(
  use: (owner: Business.OwnerId) => Effect.Effect<A, E, R>
): Effect.Effect<A, Mapped<E>, R | Api.Session> =>
  Effect.flatMap(Api.Session, ({ ownerId }) => use(ownerId)).pipe(
    Effect.mapError((error: E) => toContractError(error))
  );
