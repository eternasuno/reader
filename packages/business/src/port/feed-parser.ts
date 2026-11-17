import { Context, Data, type Effect, Schema } from 'effect';
import { ArticleTitle } from '../entity/common/article';
import { NormalizedUrl } from '../entity/common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../entity/common/option-from-optional-non-empty';
import { FeedTitle } from '../entity/feed/feed';

export class FeedParserError extends Data.TaggedError('FeedParserError')<{
  readonly message: string;
}> {}

/**
 * An entry as the source gave it, not yet cleaned: required `url`, optional
 * `publishedAt`, and text that the sanitizing of CM-HTML runs on later. The
 * parser drops every entry without a valid URL (FD-PARSE-2).
 */
export const ParsedFeedEntry = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  content: OptionFromOptionalNonEmpty(Schema.String),
  url: NormalizedUrl,
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type ParsedFeedEntry = typeof ParsedFeedEntry.Type;

/**
 * What `FeedParser` returns: the feed `title`, an optional `description`, and
 * the entries in source order.
 */
export const ParsedFeed = Schema.Struct({
  title: FeedTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  entries: Schema.Array(ParsedFeedEntry),
});

export type ParsedFeed = typeof ParsedFeed.Type;

export interface IFeedParser {
  /**
   * A `ParsedFeed`, or `FeedParserError`. `baseUrl` is the final URL from the
   * fetcher (FD-FETCH-4); the feed keeps the submitted URL. The contract is
   * FD-PARSE in the `project-business` skill's `feed.md`. Which library parses
   * the formats, and any length limit on a title, are the adapter's.
   */
  readonly parse: (
    text: string,
    baseUrl: URL
  ) => Effect.Effect<ParsedFeed, FeedParserError>;
}

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
