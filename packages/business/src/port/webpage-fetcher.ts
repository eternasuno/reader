import { Context, type Effect } from 'effect';
import type { WebpageFetcherError } from '../error/common';
import type { SettingRepositoryError } from '../error/setting';

/**
 * Fetches a web page for extraction (CM-FETCH step 1). Which provider fetches
 * is decided by the application from the owner's setting, by exhaustive match
 * with no condition of its own; the port takes no owner and no provider
 * (CM-FETCH-2).
 */
export interface IWebpageFetcher {
  /**
   * Returns the page text for the URL. Redirects, timeouts, size limits and
   * which addresses may be reached are the adapter's concern, and a page behind
   * HTTP basic auth works because a URL may carry credentials (CM-URL-4,
   * CM-FETCH-3). A failure of any of these is `WebpageFetcherError`; the server
   * may resolve the provider from the owner's setting at the first fetch, which
   * can fail with `SettingRepositoryError` (CM-FETCH-2, CM-FETCH-4).
   */
  readonly fetch: (
    url: string
  ) => Effect.Effect<string, WebpageFetcherError | SettingRepositoryError>;
}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  IWebpageFetcher
>()('@reader/business/WebpageFetcher') {}
