import { Context, Data, type Effect, type Layer } from 'effect';
import type { OwnerId } from '../entity/object-value';
import type { SettingsRepositoryReadError } from './settings-repository';

export type WebpageFetchCode = 'rate_limited' | 'key_rejected' | 'fetch_failed';

export class WebpageFetchError extends Data.TaggedError('WebpageFetchError')<{
  readonly error: string;
  readonly code?: WebpageFetchCode;
}> {}

export interface IWebpageFetcher {
  readonly fetch: (url: string) => Effect.Effect<string, WebpageFetchError>;
}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  IWebpageFetcher
>()('WebpageFetcher') {}

export interface IWebpageFetcherFactory {
  readonly forOwner: (
    owner: OwnerId
  ) => Effect.Effect<Layer.Layer<WebpageFetcher>, SettingsRepositoryReadError>;
}

export class WebpageFetcherFactory extends Context.Service<
  WebpageFetcherFactory,
  IWebpageFetcherFactory
>()('WebpageFetcherFactory') {}
