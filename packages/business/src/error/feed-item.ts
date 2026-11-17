import { Data } from 'effect';
import type { FeedItemId } from '../entity/feed-item/feed-item';

/**
 * The item does not exist for this owner. An item of another owner is reported
 * as missing (FD-EXTRACT step 1, SP-SAVE-1).
 */
export class FeedItemNotFound extends Data.TaggedError('FeedItemNotFound')<{
  readonly id: FeedItemId;
}> {}

/** A storage failure raised by the `FeedItemRepository` port. */
export class FeedItemRepositoryError extends Data.TaggedError(
  'FeedItemRepositoryError'
)<{ readonly message: string }> {}
