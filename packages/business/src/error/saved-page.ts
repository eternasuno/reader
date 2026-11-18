import { Data } from 'effect';
import type { NormalizedUrl } from '../entity/common/normalized-url';

/**
 * The owner already saved this URL, raised when adding a link or saving a feed
 * item. It carries the key, so nothing is looked up when the unique URL lost
 * the race (CM-ID-6, SP-ADD-5, SP-SAVE-7).
 */
export class SavedPageAlreadyExists extends Data.TaggedError(
  'SavedPageAlreadyExists'
)<{
  readonly url: NormalizedUrl;
}> {}

/** A storage failure raised by the `SavedPageRepository` port. */
export class SavedPageRepositoryError extends Data.TaggedError(
  'SavedPageRepositoryError'
)<{ readonly message: string }> {}
