import { Context, Data, type Effect, type Option, Struct } from 'effect';
import { Article } from '../entity/article';
import type { Feed } from '../entity/feed';

export class ParseSubscriptionError extends Data.TaggedError(
  'ParseSubscriptionError'
)<{ readonly message: string }> {}

export const ParsedArticle = Article.mapFields(
  Struct.pick(['title', 'description', 'content', 'url', 'publishedAt'])
);

export type ParsedArticle = typeof ParsedArticle.Type;

export type ParsedFeed = {
  readonly title: Feed['title'];
  readonly description: Option.Option<string>;
  readonly articles: readonly ParsedArticle[];
};

export type IFeedParser = {
  readonly parse: (
    content: string,
    sourceUrl: URL
  ) => Effect.Effect<ParsedFeed, ParseSubscriptionError>;
};

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
