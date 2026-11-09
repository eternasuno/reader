import { Context, Data, type Effect } from 'effect';

export class WebpageFetcherError extends Data.TaggedError(
  'WebpageFetcherError'
)<{
  readonly message: string;
}> {}

export interface IWebpageFetcher {
  readonly fetch: (url: string) => Effect.Effect<string, WebpageFetcherError>;
}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  IWebpageFetcher
>()('WebpageFetcher') {}
