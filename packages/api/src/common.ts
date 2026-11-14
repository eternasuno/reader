import { FolderId } from '@reader/business';
import { Effect, Schema } from 'effect';
import { HttpApiSchema } from 'effect/http-api';
import {
  ArticleEmptyContent,
  ArticleExtractorError,
  SettingRepositoryError,
  WebpageFetcherError,
} from './errors';

export const extractionErrors = [
  ArticleEmptyContent,
  WebpageFetcherError,
  ArticleExtractorError,
  SettingRepositoryError,
];

export const unreadOnly = Schema.Boolean.pipe(
  Schema.withDecodingDefaultType(Effect.succeed(false))
);

export const limit = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);

export const urlPayload = Schema.Struct({
  url: Schema.String,
});

export const subscribePayload = Schema.Struct({
  url: Schema.String,
  title: Schema.optionalKey(Schema.String),
  folderId: Schema.optionalKey(FolderId),
});

export const ok = Schema.Struct({ ok: Schema.Boolean });

export const created = <S extends Schema.Top>(schema: S) =>
  schema.pipe(HttpApiSchema.status(201));
