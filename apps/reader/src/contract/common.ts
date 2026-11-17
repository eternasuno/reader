import { Effect, Schema, SchemaTransformation } from 'effect';
import { HttpApiSchema } from 'effect/http-api';
import {
  ArticleEmptyContent,
  ArticleExtractorError,
  WebpageFetcherError,
} from './errors';

/**
 * `limit` is a positive integer supplied by the caller; the boundary rejects
 * zero, negative and non-integer values (CM-PAGE-2). A query parameter arrives
 * as a string and is decoded by the endpoint's string-tree codec.
 */
export const limitQuery = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);

/**
 * `unread` follows the route's convention: `?unread` (an empty value) and
 * `unread=true` are on, `unread=false` and an absent parameter are off
 * (reader-spec: Routes, CM-PAGE-8). Any other value is a structural failure.
 */
const unreadValue = Schema.Literals(['true', 'false', '']).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform<boolean, 'true' | 'false' | ''>({
      decode: (value) => value !== 'false',
      encode: (value) => (value ? 'true' : 'false'),
    })
  )
);

/** `unread` defaults to `false` when the parameter is absent (CM-PAGE-8). */
export const unreadQuery = unreadValue.pipe(
  Schema.withDecodingDefaultType(Effect.succeed(false))
);

/**
 * The 422 tags of an endpoint that fetches and extracts an article (CM-FETCH-4).
 * A page that cannot be parsed is answered as `ArticleExtractorError`, so no
 * endpoint declares `HtmlParserError`.
 */
export const extractionErrors = [
  ArticleEmptyContent,
  WebpageFetcherError,
  ArticleExtractorError,
] as const;

/** Answers 201 with the body, used by every create (SKILL.md API conventions). */
export const created = <S extends Schema.Top>(schema: S) =>
  schema.pipe(HttpApiSchema.status(201));
