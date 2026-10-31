import { Schema } from 'effect';
import { ArticleId } from '../entity/model';

export class InvalidArticleUrl extends Schema.TaggedError<InvalidArticleUrl>()(
  'InvalidArticleUrl',
  { message: Schema.String }
) {}

export class ArticleNotFound extends Schema.TaggedError<ArticleNotFound>()(
  'ArticleNotFound',
  { message: Schema.String }
) {}

export class ArticleNotInFeed extends Schema.TaggedError<ArticleNotInFeed>()(
  'ArticleNotInFeed',
  { message: Schema.String }
) {}

export class ArticleNotLater extends Schema.TaggedError<ArticleNotLater>()(
  'ArticleNotLater',
  { message: Schema.String }
) {}

export class ArticleMissingUrl extends Schema.TaggedError<ArticleMissingUrl>()(
  'ArticleMissingUrl',
  { message: Schema.String }
) {}

export class ArticleEmptyContent extends Schema.TaggedError<ArticleEmptyContent>()(
  'ArticleEmptyContent',
  { message: Schema.String }
) {}

export class DuplicateArticle extends Schema.TaggedError<DuplicateArticle>()(
  'DuplicateArticle',
  { id: ArticleId, message: Schema.String }
) {}

export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()(
  'InvalidCursor',
  { message: Schema.String }
) {}
