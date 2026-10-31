import { Context, Data, type Effect, type Redacted } from 'effect';
import type { ReaderProvider } from '../entity/article';

export class WebpageFetchError extends Data.TaggedError('WebpageFetchError')<{
  readonly error: string;
}> {}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  {
    readonly fetch: (
      url: string,
      key: Redacted.Redacted<string> | undefined,
      provider: ReaderProvider,
      endpoint?: string
    ) => Effect.Effect<string, WebpageFetchError>;
  }
>()('WebpageFetcher') {}
