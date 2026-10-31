import { Context, type Effect, Schema } from 'effect';

export class ContentProcessError extends Schema.TaggedError<ContentProcessError>()(
  'ContentProcessError',
  { message: Schema.String }
) {}

export class ContentProcessor extends Context.Service<
  ContentProcessor,
  {
    readonly process: (
      content: string,
      text: boolean,
      url?: URL
    ) => Effect.Effect<string, ContentProcessError>;
  }
>()('@reader/business/ContentProcessor') {}
