import { Context, type Effect, Schema } from 'effect';
import type { Article } from '../entity/article';
import type { Feed } from '../entity/feed';

export class ParseSubscriptionError extends Schema.TaggedError<ParseSubscriptionError>()(
  'ParseSubscriptionError',
  { message: Schema.String }
) {}

export type ParsedArticle = Pick<
  Article,
  'title' | 'description' | 'content' | 'url'
> &
  Partial<Pick<Article, 'publishedAt'>>;

export type ParsedFeed = {
  readonly title: Feed['title'];
  readonly description?: Article['description'];
  readonly articles: readonly ParsedArticle[];
};

export interface IFeedParser {
  readonly parse: (
    content: string,
    sourceUrl: URL
  ) => Effect.Effect<ParsedFeed, ParseSubscriptionError>;
}

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
