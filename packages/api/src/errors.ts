import { Data, Schema } from 'effect';
import { HttpApiSchema } from 'effect/http-api';

export class LinksUnavailable extends Data.TaggedError('LinksUnavailable')<{
  readonly error: string;
}> {}

export const LinksUnavailableSchema = Schema.Struct({
  _tag: Schema.Literal('LinksUnavailable'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(500));

export const InvalidLinkSchema = Schema.Struct({
  _tag: Schema.Literal('InvalidLink'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(400));

export const DuplicateLinkSchema = Schema.Struct({
  _tag: Schema.Literal('DuplicateLink'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(409));

export const LinkNotFoundSchema = Schema.Struct({
  _tag: Schema.Literal('LinkNotFound'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(404));

export const InvalidFeedSchema = Schema.Struct({
  _tag: Schema.Literal('InvalidFeed'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(400));

export const InvalidPreviewSchema = Schema.Struct({
  _tag: Schema.Literal('InvalidPreview'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(400));

export const FeedNotFoundSchema = Schema.Struct({
  _tag: Schema.Literal('FeedNotFound'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(404));

export const FeedFetchErrorSchema = Schema.Struct({
  _tag: Schema.Literal('FeedFetchError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const FeedPreviewStoreErrorSchema = Schema.Struct({
  _tag: Schema.Literal('FeedPreviewStoreError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const ArticleFailureSchema = Schema.Struct({
  _tag: Schema.Literal('ArticleFailure'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const ArticleExtractErrorSchema = Schema.Struct({
  _tag: Schema.Literal('ArticleExtractError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const ArticleRepositoryErrorSchema = Schema.Struct({
  _tag: Schema.Literal('ArticleRepositoryError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const ReaderCredentialsErrorSchema = Schema.Struct({
  _tag: Schema.Literal('ReaderCredentialsError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));

export const WebpageFetchErrorSchema = Schema.Struct({
  _tag: Schema.Literal('WebpageFetchError'),
  error: Schema.String,
}).pipe(HttpApiSchema.status(422));
