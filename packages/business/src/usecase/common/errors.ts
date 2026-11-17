import { Data } from 'effect';

/** The extracted content is empty (CM-ART-5, CM-FETCH step 4). */
export class ArticleEmptyContent extends Data.TaggedError(
  'ArticleEmptyContent'
)<Record<never, never>> {}
