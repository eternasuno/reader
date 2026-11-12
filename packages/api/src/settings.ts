import { FetcherProvider, Retention } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  BrowserEndpointRequiredSchema,
  InvalidEndpointSchema,
  InvalidKeySchema,
  InvalidProviderSchema,
  InvalidRetentionSchema,
  ok,
  settingErrors,
} from './common';

const SettingsResponse = Schema.Struct({
  retention: Retention,
  provider: FetcherProvider,
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
});

export const settingEndpoints = [
  HttpApiEndpoint.get('settings', '/api/library/settings', {
    success: SettingsResponse,
    error: settingErrors,
  }),
  HttpApiEndpoint.put('setRetention', '/api/library/settings/retention', {
    payload: Schema.Struct({ retention: Schema.Number }),
    success: ok,
    error: [InvalidRetentionSchema, ...settingErrors],
  }),
  HttpApiEndpoint.put('setFetcher', '/api/library/settings/fetcher', {
    payload: Schema.Struct({
      provider: Schema.String,
      key: Schema.optionalKey(Schema.String),
      endpoint: Schema.optionalKey(Schema.String),
    }),
    success: ok,
    error: [
      InvalidProviderSchema,
      InvalidKeySchema,
      InvalidEndpointSchema,
      BrowserEndpointRequiredSchema,
      ...settingErrors,
    ],
  }),
  HttpApiEndpoint.delete('deleteKey', '/api/library/settings/key', {
    success: ok,
    error: settingErrors,
  }),
] as const;
