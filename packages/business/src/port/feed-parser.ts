import { Context, Data, type Effect, Schema, Struct } from 'effect';
import { Feed } from '../entity/feed/feed';
import { FeedItem } from '../entity/feed/feed-item';

export class FeedParserError extends Data.TaggedError('FeedParserError')<{
  readonly message: string;
}> {}

export const ParsedFeedItem = FeedItem.mapFields(
  Struct.pick(['title', 'description', 'content', 'url', 'publishedAt'])
);

export type ParsedFeedItem = typeof ParsedFeedItem.Type;

export const ParsedFeed = Schema.Struct({
  ...Struct.pick(Feed.fields, ['title', 'url']),
  description: Schema.OptionFromOptional(Schema.String),
  items: Schema.Array(ParsedFeedItem),
});

export type ParsedFeed = typeof ParsedFeed.Type;

export interface IFeedParser {
  readonly parse: (
    content: string,
    sourceUrl: URL
  ) => Effect.Effect<ParsedFeed, FeedParserError>;
}

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
