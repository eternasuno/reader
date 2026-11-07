import type { BrowserEndpoint, WebpageFetcher } from '@reader/business';
import {
  type BrowserConcurrency,
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import type { Layer, Redacted } from 'effect';

export const jinaWebpageFetcherLive = (
  key?: Redacted.Redacted<string> | undefined
): Layer.Layer<WebpageFetcher> => JinaWebpageFetcherLive(key);

export const browserWebpageFetcherLive = (
  endpoint: BrowserEndpoint | undefined
): Layer.Layer<WebpageFetcher, never, BrowserConcurrency> =>
  BrowserWebpageFetcherLive(endpoint);
