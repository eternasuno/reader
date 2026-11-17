import { Context, Data, type Effect } from 'effect';

export class WebpageFetcherError extends Data.TaggedError(
  'WebpageFetcherError'
)<{
  readonly message: string;
}> {}

export interface IWebpageFetcher {
  /**
   * Fetches the page at the URL text and returns the page text. Redirects,
   * timeouts, size limits and which addresses may be reached are the
   * adapter's concern (CM-FETCH).
   */
  readonly fetch: (url: string) => Effect.Effect<string, WebpageFetcherError>;
}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  IWebpageFetcher
>()('@reader/business/WebpageFetcher') {}
