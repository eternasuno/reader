import {
  type BrowserEndpoint,
  BrowserEndpoint as BrowserEndpointSchema,
  type FeedTitle,
  type FolderName,
  FolderName as FolderNameSchema,
  type JinaKey,
  JinaKey as JinaKeySchema,
  makeFeedTitle,
  type NormalizedUrl,
  NormalizedUrl as NormalizedUrlSchema,
  type PageInput,
  type Retention,
  Retention as RetentionSchema,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  FeedUrlInvalid,
  InvalidEndpoint,
  InvalidFolderName,
  InvalidPageUrl,
  InvalidRetention,
} from '../../contract';

/**
 * Decoding at the HTTP boundary (reader-spec: API conventions). A value that
 * is well formed but breaks a domain value rule fails with the domain's
 * contract tag, which is a 400; structural failures are the contract's own
 * decoding and answer an empty 400 before a handler runs.
 */

/** Decodes one string into a business value, failing with the domain tag. */
const decodeInto =
  <S extends Schema.Constraint, E>(schema: S, fail: () => E) =>
  (raw: S['Encoded']): Effect.Effect<S['Type'], E, S['DecodingServices']> =>
    Schema.decodeUnknownEffect(schema)(raw).pipe(Effect.mapError(fail));

/** A `稍后阅读` address: `InvalidPageUrl` when it is not an http(s) URL. */
export const decodePageUrl = (
  raw: string
): Effect.Effect<NormalizedUrl, InvalidPageUrl> =>
  decodeInto(NormalizedUrlSchema, () => new InvalidPageUrl())(raw);

/** A feed address: `FeedUrlInvalid` when it is not an http(s) URL. */
export const decodeFeedUrl = (
  raw: string
): Effect.Effect<NormalizedUrl, FeedUrlInvalid> =>
  decodeInto(NormalizedUrlSchema, () => new FeedUrlInvalid())(raw);

/** A folder name is trimmed; blank after trimming is `InvalidFolderName`. */
export const decodeFolderName = (
  raw: string
): Effect.Effect<FolderName, InvalidFolderName> =>
  decodeInto(FolderNameSchema, () => new InvalidFolderName())(raw);

/** Retention is an integer of at least 1 (SET-VAL-1). */
export const decodeRetention = (
  raw: number
): Effect.Effect<Retention, InvalidRetention> =>
  Schema.decodeEffect(RetentionSchema)(raw).pipe(
    Effect.mapError(() => new InvalidRetention())
  );

/**
 * The browser endpoint: absent or blank counts as not given (SET-VAL-6), a
 * given value must be an http, https, ws or wss URL (SET-VAL-3).
 */
export const decodeBrowserEndpoint = (
  raw: string | undefined
): Effect.Effect<Option.Option<BrowserEndpoint>, InvalidEndpoint> =>
  Effect.gen(function* () {
    if (raw === undefined || raw.trim() === '') {
      return Option.none();
    }

    const endpoint = yield* Schema.decodeEffect(BrowserEndpointSchema)(
      raw
    ).pipe(Effect.mapError(() => new InvalidEndpoint()));

    return Option.some(endpoint);
  });

/**
 * The Jina key: absent or blank counts as not given (SET-VAL-6); a given key
 * is trimmed by the entity schema (SET-VAL-2). Never shown again (SET-VAL-4).
 */
export const decodeJinaKey = (
  raw: string | undefined
): Option.Option<JinaKey> =>
  Option.flatMap(Option.fromNullishOr(raw), (key) =>
    Schema.decodeOption(JinaKeySchema)(key)
  );

/** A missing or blank subscribe title becomes the address's host (FD-SUB). */
export const feedTitleOf = (
  raw: string | undefined,
  url: NormalizedUrl
): FeedTitle => makeFeedTitle(raw ?? '', url);

/** The list query as business paging input (CM-PAGE-2, CM-PAGE-3, CM-PAGE-8). */
export const pageInput = <Id>(query: {
  readonly limit: number;
  readonly unread: boolean;
  readonly cursor?: Id | undefined;
}): PageInput<Id> => ({
  limit: query.limit,
  unread: query.unread,
  cursor: Option.fromNullishOr(query.cursor),
});
