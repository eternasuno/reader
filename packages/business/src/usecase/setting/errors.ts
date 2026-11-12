import { Data } from 'effect';

export class BrowserEndpointRequired extends Data.TaggedError(
  'BrowserEndpointRequired'
)<Record<never, never>> {}
