import { Context, Data, type Effect, Schema, Struct } from 'effect';
import { Article } from '../entity/article';
import { Feed } from '../entity/feed';

export class FeedParserError extends Data.TaggedError('FeedParserError')<{
  readonly message: string;
}> {}

export const ParsedArticle = Article.mapFields(
  Struct.pick(['title', 'description', 'content', 'url', 'publishedAt'])
);

export type ParsedArticle = typeof ParsedArticle.Type;

export const ParsedFeed = Schema.Struct({
  ...Struct.pick(Feed.fields, ['title', 'url']),
  description: Schema.OptionFromOptional(Schema.String),
  articles: Schema.Array(ParsedArticle),
});

export type ParsedFeed = typeof ParsedFeed.Type;

export type IFeedParser = {
  readonly parse: (
    content: string,
    sourceUrl: URL
  ) => Effect.Effect<ParsedFeed, FeedParserError>;
};

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
