import { Context, Data, type Effect, type Layer } from 'effect';

export class WebpageFetcherError extends Data.TaggedError(
  'WebpageFetcherError'
)<{
  readonly message: string;
}> {}

export type IWebpageFetcher = {
  readonly fetch: (url: string) => Effect.Effect<string, WebpageFetcherError>;
};

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  IWebpageFetcher
>()('WebpageFetcher') {}

export class WebpageFetcherLayer extends Context.Service<
  WebpageFetcherLayer,
  Layer.Layer<WebpageFetcher>
>()('WebpageFetcherLayer') {}
