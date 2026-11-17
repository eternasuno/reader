import { FetcherProvider, Retention } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  BrowserEndpointRequired,
  InvalidEndpoint,
  InvalidRetention,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

/**
 * The settings as a response: exactly these four fields, never the Jina key and
 * never the browser endpoint, which the entity holds as redacted secrets
 * (settings.md API, SET-VAL-4).
 */
const SettingResponse = Schema.Struct({
  retention: Retention,
  provider: FetcherProvider,
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
});

/** Settings: read, retention, the fetcher choice and the Jina key. */
export const SettingApi = HttpApiGroup.make('setting').add(
  HttpApiEndpoint.get('getSetting', '/settings', {
    success: SettingResponse,
    error: SettingRepositoryError,
  }),
  HttpApiEndpoint.put('setRetention', '/settings/retention', {
    payload: Schema.Struct({ retention: Schema.Finite }),
    error: [InvalidRetention, SettingRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('useJinaFetcher', '/settings/fetcher/jina', {
    payload: Schema.Struct({ key: Schema.optional(Schema.String) }),
    error: SettingRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('useBrowserFetcher', '/settings/fetcher/browser', {
    payload: Schema.Struct({ endpoint: Schema.optional(Schema.String) }),
    error: [InvalidEndpoint, BrowserEndpointRequired, SettingRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeJinaKey', '/settings/fetcher/jina/key', {
    error: SettingRepositoryError,
  }).middleware(OriginCheck)
);
