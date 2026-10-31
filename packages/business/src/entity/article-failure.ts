import { Data } from 'effect';

export class ArticleFailure extends Data.TaggedError('ArticleFailure')<{
  readonly error: string;
}> {}
