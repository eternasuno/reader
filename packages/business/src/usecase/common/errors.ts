import { Data } from 'effect';

export class ArticleEmptyContent extends Data.TaggedError(
  'ArticleEmptyContent'
)<Record<never, never>> {}
