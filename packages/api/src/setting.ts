import { FetcherProvider, Retention } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import { ok } from './common';
import {
  BrowserEndpointRequired,
  InvalidEndpoint,
  InvalidRetention,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const SettingsResponse = Schema.Struct({
  retention: Retention,
  provider: FetcherProvider,
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
});

export const settingEndpoints = [
  HttpApiEndpoint.get('settings', '/api/library/settings', {
    success: SettingsResponse,
    error: SettingRepositoryError,
  }),
  HttpApiEndpoint.put('setRetention', '/api/library/settings/retention', {
    payload: Schema.Struct({ retention: Schema.Number }),
    success: ok,
    error: [InvalidRetention, SettingRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('useJinaFetcher', '/api/library/settings/fetcher/jina', {
    payload: Schema.Struct({ key: Schema.optionalKey(Schema.String) }),
    success: ok,
    error: SettingRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.put(
    'useBrowserFetcher',
    '/api/library/settings/fetcher/browser',
    {
      payload: Schema.Struct({ endpoint: Schema.optionalKey(Schema.String) }),
      success: ok,
      error: [InvalidEndpoint, BrowserEndpointRequired, SettingRepositoryError],
    }
  ).middleware(OriginCheck),
  HttpApiEndpoint.delete('deleteKey', '/api/library/settings/key', {
    success: ok,
    error: SettingRepositoryError,
  }).middleware(OriginCheck),
] as const;
