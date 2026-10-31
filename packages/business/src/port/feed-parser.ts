import { Context, Data, type Effect } from 'effect';
import type { ParsedFeed } from '../entity/feed';

export class FeedParseError extends Data.TaggedError('FeedParseError')<{
  readonly error: string;
}> {}

export class FeedParser extends Context.Service<
  FeedParser,
  {
    readonly parse: (
      content: string,
      baseUrl: string
    ) => Effect.Effect<ParsedFeed, FeedParseError>;
  }
>()('@reader/business/FeedParser') {}
