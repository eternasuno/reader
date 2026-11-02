import { Schema } from 'effect';

export class FetchSubscriptionError extends Schema.TaggedError<FetchSubscriptionError>()(
  'FetchSubscriptionError',
  { message: Schema.String }
) {}
