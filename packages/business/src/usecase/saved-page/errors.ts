import { Data } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';

/** The owner already saved this URL; raised when adding a link or saving a feed item (SP-ADD, SP-SAVE). */
export class SavedPageAlreadyExists extends Data.TaggedError(
  'SavedPageAlreadyExists'
)<{
  readonly url: NormalizedUrl;
}> {}
