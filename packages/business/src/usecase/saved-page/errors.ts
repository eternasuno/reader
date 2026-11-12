import { Data } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';

export class SavedPageAlreadyExists extends Data.TaggedError(
  'SavedPageAlreadyExists'
)<{
  readonly url: NormalizedUrl;
}> {}
