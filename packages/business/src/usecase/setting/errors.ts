import { Data } from 'effect';

/**
 * The browser provider was chosen and no endpoint is given or stored
 * (SET-FETCH-3). Nothing is stored.
 */
export class BrowserEndpointRequired extends Data.TaggedError(
  'BrowserEndpointRequired'
)<Record<never, never>> {}
