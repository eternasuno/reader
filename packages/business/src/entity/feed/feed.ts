import { Effect, Schema } from 'effect';
import { Model } from 'effect/schema';
import { ArticleTitle } from '../common/article';
import { NormalizedUrl } from '../common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../common/optional';
import { OwnerId } from '../common/owner-id';
import { FolderId } from '../folder/folder';

/** A lower-case version-7 UUID (CM-ID); decoding rejects anything else. */
export const FeedId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FeedId')
);

export type FeedId = typeof FeedId.Type;

/** Trimmed (FD-PARSE-8). */
export const FeedTitle = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('FeedTitle')
);

export type FeedTitle = typeof FeedTitle.Type;

/**
 * The title as the boundary decodes it (FD-SUB, FD-PARSE-8): trimmed, and the
 * host of the address when nothing is left.
 */
export const makeFeedTitle = (text: string, url: URL): FeedTitle => {
  const trimmed = text.trim();

  return FeedTitle.make(trimmed === '' ? url.host : trimmed);
};

/**
 * What the reader shows first for an item of the feed (FD-PREF-1, RD-MODE-4):
 * the feed's own content, the extracted article or the embedded web page.
 * A new feed starts with `default`.
 */
export const FeedReaderMode = Schema.Literals([
  'default',
  'extracted',
  'embedded',
]).pipe(Schema.withConstructorDefault(Effect.succeed('default' as const)));

export type FeedReaderMode = typeof FeedReaderMode.Type;

/**
 * The order of the feed's own list (FD-PREF-3): `newest` is arrival order,
 * `oldest` its reverse. A new feed starts with `newest`.
 */
export const FeedOrder = Schema.Literals(['newest', 'oldest']).pipe(
  Schema.withConstructorDefault(Effect.succeed('newest' as const))
);

export type FeedOrder = typeof FeedOrder.Type;

/**
 * One owner's subscription to one source address. One feed per
 * `(ownerId, url)` (CM-ID-6, FD-ID-1).
 */
export const Feed = Schema.Struct({
  /** Made when the feed is created (CM-ID-3). */
  id: Model.UuidV7WithGenerate(FeedId),
  ownerId: OwnerId,
  /**
   * The submitted address after normalization, never a redirect target
   * (CM-URL-5, FD-FETCH-4).
   */
  url: NormalizedUrl,
  /**
   * The preview title at subscribe; the source's title replaces it on every
   * successful sync (FD-SUB-3, FD-SYNC step 5).
   */
  title: FeedTitle,
  /**
   * The folder the feed is in; none at the top level. Always a folder of the
   * same owner (FD-FOLDER-3, FD-FOLDER-6).
   */
  folderId: Schema.OptionFromOptional(FolderId),
  /**
   * The time of the last successful sync; none until the first one
   * (FD-SYNC step 5).
   */
  updatedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  /** Kept by refresh, sync and moving (FD-PREF-5). */
  readerMode: FeedReaderMode,
  /** Kept by refresh, sync and moving (FD-PREF-5). */
  order: FeedOrder,
});

export type Feed = typeof Feed.Type;

/**
 * One entry as the source lists it, before anything is cleaned: its text is
 * plain, trimmed, non-blank text, not yet sanitized (CM-ART-2, CM-ART-3,
 * CM-HTML). The parser drops every entry without a usable URL (FD-PARSE-2) and
 * keeps the rest in source order (FD-PARSE-9).
 */
export const ParsedFeedEntry = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  content: OptionFromOptionalNonEmpty(Schema.String),
  /** Resolved against the final URL of the source (FD-PARSE-2, FD-FETCH-4). */
  url: NormalizedUrl,
  /** The source's own field only; a missing or unparseable time is none (FD-PARSE-7). */
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type ParsedFeedEntry = typeof ParsedFeedEntry.Type;

/**
 * What `FeedParser` returns for one source (FD-FETCH-1): the feed title, its
 * description if any, and the entries in source order (FD-PARSE-8).
 */
export const ParsedFeed = Schema.Struct({
  title: FeedTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  entries: Schema.Array(ParsedFeedEntry),
});

export type ParsedFeed = typeof ParsedFeed.Type;
