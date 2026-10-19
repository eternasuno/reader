import { Context, type Effect, Schema } from 'effect';
import type { ParsedFeed } from '../entity/feed';

export class FeedParseError extends Schema.TaggedError<FeedParseError>()(
  'FeedParseError',
  { error: Schema.String }
) {}

export class FeedParser extends Context.Service<
  FeedParser,
  {
    readonly parse: (
      content: string,
      baseUrl: string
    ) => Effect.Effect<ParsedFeed, FeedParseError>;
  }
>()('@reader/business/FeedParser') {}
