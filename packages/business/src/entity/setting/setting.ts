import { Schema } from 'effect';
import { OptionFromOptionalNonEmpty } from '../common/optional';
import { OwnerId } from '../common/owner-id';
import { BrowserEndpoint, FetcherProvider, JinaKey } from './fetcher';
import { KindleDelivery, SmtpPassword } from './kindle';
import { Retention } from './retention';

/**
 * One owner's settings. A user without stored settings reads the value
 * decoding gives: retention 100, provider `jina`, no key and no endpoint
 * (SET-GET-1); the defaults live on the value types (SET-VAL-5).
 *
 * Both providers' configuration is stored at the same time, so switching
 * provider never discards the other one (SET-FETCH-5); once configured, an
 * endpoint stays stored even while the provider is `jina` (SET-ENDPOINT-2).
 * The key, the endpoint and the SMTP password are secrets: they are redacted
 * and never leave the business layer (SET-VAL-4).
 */
export const Setting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  /** `browser` only if an endpoint is stored (SET-FETCH-4). */
  provider: FetcherProvider,
  /** Kept while the browser provider is chosen (SET-FETCH-1). */
  jinaKey: OptionFromOptionalNonEmpty(JinaKey),
  /** Never cleared, only replaced (SET-ENDPOINT-1). */
  browserEndpoint: OptionFromOptionalNonEmpty(BrowserEndpoint),
  /** None until the Kindle delivery is first saved (SET-KINDLE). */
  kindle: Schema.OptionFromOptional(KindleDelivery),
  /** Kept when a save gives none; cleared only by its own write (SET-KINDLE-2). */
  smtpPassword: Schema.OptionFromOptional(SmtpPassword),
  /**
   * The instant of the next scheduled send, written with the Kindle delivery
   * and pushed forward by the scheduler after every check (KD-SCHED-1); none
   * means no scheduled send. The scheduler owns it.
   */
  nextSendAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type Setting = typeof Setting.Type;
