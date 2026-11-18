import { Data } from 'effect';

/**
 * The browser provider was chosen and neither the request nor the stored
 * setting has an endpoint; nothing is stored (SET-FETCH-3).
 */
export class BrowserEndpointRequired extends Data.TaggedError(
  'BrowserEndpointRequired'
)<Record<never, never>> {}

/** A storage failure raised by the `SettingRepository` port. */
export class SettingRepositoryError extends Data.TaggedError(
  'SettingRepositoryError'
)<{ readonly message: string }> {}
