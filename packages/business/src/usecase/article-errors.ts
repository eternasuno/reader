import { Data } from 'effect';
import type { ArticleId } from '../entity/article';

export class InvalidArticleUrl extends Data.TaggedError('InvalidArticleUrl')<{
  readonly message: string;
}> {}

export class ArticleNotFound extends Data.TaggedError('ArticleNotFound')<{
  readonly message: string;
}> {}

export class ArticleNotInFeed extends Data.TaggedError('ArticleNotInFeed')<{
  readonly message: string;
}> {}

export class ArticleNotLater extends Data.TaggedError('ArticleNotLater')<{
  readonly message: string;
}> {}

export class ArticleMissingUrl extends Data.TaggedError('ArticleMissingUrl')<{
  readonly message: string;
}> {}

export class ArticleEmptyContent extends Data.TaggedError(
  'ArticleEmptyContent'
)<{
  readonly message: string;
}> {}

export class DuplicateArticle extends Data.TaggedError('DuplicateArticle')<{
  readonly id: ArticleId;
  readonly message: string;
}> {}

export class InvalidCursor extends Data.TaggedError('InvalidCursor')<{
  readonly message: string;
}> {}
