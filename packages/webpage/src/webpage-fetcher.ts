import { WebpageFetcher, WebpageFetcherError } from '@reader/business';
import { Effect, Layer, type Redacted } from 'effect';
import { fetchBrowser } from './browser';
import type { FetchFailure } from './failure';
import { fetchJina } from './jina';

const toWebpageFetcherError = (failure: FetchFailure): WebpageFetcherError =>
  new WebpageFetcherError({ message: failure.message });

export const JinaWebpageFetcherLive = (
  key: Redacted.Redacted<string> | undefined
): Layer.Layer<WebpageFetcher> =>
  Layer.succeed(WebpageFetcher, {
    fetch: (url) =>
      fetchJina(url, key).pipe(Effect.mapError(toWebpageFetcherError)),
  });

export const BrowserWebpageFetcherLive = (
  endpoint: string
): Layer.Layer<WebpageFetcher> =>
  Layer.succeed(WebpageFetcher, {
    fetch: (url) =>
      fetchBrowser(url, endpoint).pipe(Effect.mapError(toWebpageFetcherError)),
  });
