import { Context, type Effect, Schema } from 'effect';

export class FetchSubscriptionError extends Schema.TaggedError<FetchSubscriptionError>()(
  'FetchSubscriptionError',
  { message: Schema.String }
) {}

export class ParseSubscriptionError extends Schema.TaggedError<ParseSubscriptionError>()(
  'ParseSubscriptionError',
  { message: Schema.String }
) {}

export const SubscriptionEntry = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  descriptionText: Schema.optional(Schema.Boolean),
  contentText: Schema.optional(Schema.Boolean),
  url: Schema.optional(Schema.URL),
  publishedAt: Schema.optional(Schema.DateTimeUtc),
});

export type SubscriptionEntry = typeof SubscriptionEntry.Type;

export const SyndicatedFeed = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  articles: Schema.Array(SubscriptionEntry),
});

export type SyndicatedFeed = typeof SyndicatedFeed.Type;

export class Syndication extends Context.Service<
  Syndication,
  {
    readonly fetch: (
      url: URL
    ) => Effect.Effect<
      SyndicatedFeed,
      FetchSubscriptionError | ParseSubscriptionError
    >;
  }
>()('@reader/business/Syndication') {}
