import type {
  BrowserEndpoint,
  JinaKey,
  WebpageFetcher,
} from '@reader/business';
import {
  type BrowserConcurrency,
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { type Layer, Redacted } from 'effect';

export const jinaWebpageFetcherLive = (
  key?: JinaKey
): Layer.Layer<WebpageFetcher> => JinaWebpageFetcherLive(key);

export const browserWebpageFetcherLive = (
  endpoint?: BrowserEndpoint
): Layer.Layer<WebpageFetcher, never, BrowserConcurrency> =>
  BrowserWebpageFetcherLive(
    endpoint === undefined ? undefined : Redacted.value(endpoint)
  );
