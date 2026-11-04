import { Data } from 'effect';

export class FetchSubscriptionError extends Data.TaggedError(
  'FetchSubscriptionError'
)<{ readonly message: string }> {}
