import { Context, Data, type Effect, Schema } from 'effect';
import { ArticleTitle } from '../entity/common/article';
import { NormalizedUrl } from '../entity/common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../entity/common/option-from-optional-non-empty';
import { FeedTitle } from '../entity/feed/feed';

export class FeedParserError extends Data.TaggedError('FeedParserError')<{
  readonly message: string;
}> {}

export const ParsedFeedEntry = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  content: OptionFromOptionalNonEmpty(Schema.String),
  url: NormalizedUrl,
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type ParsedFeedEntry = typeof ParsedFeedEntry.Type;

export const ParsedFeed = Schema.Struct({
  title: FeedTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  entries: Schema.Array(ParsedFeedEntry),
});

export type ParsedFeed = typeof ParsedFeed.Type;

export interface IFeedParser {
  readonly parse: (
    text: string,
    baseUrl: URL
  ) => Effect.Effect<ParsedFeed, FeedParserError>;
}

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
