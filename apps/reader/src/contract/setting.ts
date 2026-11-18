import {
  EmailAddress,
  FetcherProvider,
  Retention,
  SendTime,
  SmtpHost,
  SmtpPort,
  SmtpSecurity,
  SmtpUser,
} from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  BrowserEndpointRequired,
  InvalidEndpoint,
  InvalidKindleSetting,
  InvalidRetention,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

/**
 * The stored Kindle delivery as a response: every value but the password, of
 * which only whether one is stored (settings.md API, SET-KINDLE-2).
 */
const KindleResponse = Schema.Struct({
  kindleEmail: EmailAddress,
  senderEmail: EmailAddress,
  smtpHost: SmtpHost,
  smtpPort: SmtpPort,
  smtpSecurity: SmtpSecurity,
  smtpUser: Schema.optional(SmtpUser),
  sendTime: Schema.optional(SendTime),
  smtpPasswordConfigured: Schema.Boolean,
});

/**
 * The settings as a response: these fields, never the Jina key, the browser
 * endpoint or the SMTP password, which the entity holds as redacted secrets
 * (settings.md API, SET-VAL-4). `kindle` is absent until it is saved
 * (SET-KINDLE-5).
 */
const SettingResponse = Schema.Struct({
  retention: Retention,
  provider: FetcherProvider,
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
  kindle: Schema.optional(KindleResponse),
});

/**
 * The Kindle delivery as typed: plain strings and a number, decoded into the
 * value types by the handler so a broken rule answers `InvalidKindleSetting`
 * (SET-KINDLE-1); blank optional strings count as not given (SET-KINDLE-3).
 */
const KindlePayload = Schema.Struct({
  kindleEmail: Schema.String,
  senderEmail: Schema.String,
  smtpHost: Schema.String,
  smtpPort: Schema.Finite,
  smtpSecurity: Schema.String,
  smtpUser: Schema.optional(Schema.String),
  smtpPassword: Schema.optional(Schema.String),
  sendTime: Schema.optional(Schema.String),
});

/** Settings: read, retention, the fetcher choice, the Jina key and the Kindle delivery. */
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
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('setKindle', '/settings/kindle', {
    payload: KindlePayload,
    error: [InvalidKindleSetting, SettingRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeSmtpPassword', '/settings/kindle/password', {
    error: SettingRepositoryError,
  }).middleware(OriginCheck)
);
