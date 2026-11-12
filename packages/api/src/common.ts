import { Effect, Schema } from 'effect';
import { HttpApiSchema } from 'effect/http-api';

const failure = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.Literal(tag),
    message: Schema.String,
    id: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }).pipe(HttpApiSchema.status(status));

export const UnauthorizedSchema = failure('Unauthorized', 401);

export const ForbiddenSchema = failure('Forbidden', 403);

export const InvalidPageUrlSchema = failure('InvalidPageUrl', 400);

export const FeedUrlInvalidSchema = failure('FeedUrlInvalid', 400);

export const InvalidRetentionSchema = failure('InvalidRetention', 400);

export const InvalidProviderSchema = failure('InvalidProvider', 400);

export const InvalidKeySchema = failure('InvalidKey', 400);

export const InvalidEndpointSchema = failure('InvalidEndpoint', 400);

export const FeedItemNotFoundSchema = failure('FeedItemNotFound', 404);

export const SavedPageAlreadyExistsSchema = failure(
  'SavedPageAlreadyExists',
  409
);

export const FeedAlreadyExistsSchema = failure('FeedAlreadyExists', 409);

export const ArticleEmptyContentSchema = failure('ArticleEmptyContent', 422);

export const WebpageFetcherErrorSchema = failure('WebpageFetcherError', 422);

export const ArticleExtractorErrorSchema = failure(
  'ArticleExtractorError',
  422
);

export const FetchFeedErrorSchema = failure('FetchFeedError', 422);

export const FeedParserErrorSchema = failure('FeedParserError', 422);

export const BrowserEndpointRequiredSchema = failure(
  'BrowserEndpointRequired',
  422
);

export const FeedItemRepositoryErrorSchema = failure(
  'FeedItemRepositoryError',
  500
);

export const FeedRepositoryErrorSchema = failure('FeedRepositoryError', 500);

export const SavedPageRepositoryErrorSchema = failure(
  'SavedPageRepositoryError',
  500
);

export const SettingRepositoryErrorSchema = failure(
  'SettingRepositoryError',
  500
);

export const authErrors = [UnauthorizedSchema, ForbiddenSchema];

export const savedPageErrors = [SavedPageRepositoryErrorSchema, ...authErrors];

export const feedItemErrors = [FeedItemRepositoryErrorSchema, ...authErrors];

export const settingErrors = [SettingRepositoryErrorSchema, ...authErrors];

export const extractionErrors = [
  ArticleEmptyContentSchema,
  WebpageFetcherErrorSchema,
  ArticleExtractorErrorSchema,
  ...settingErrors,
];

export const unreadOnly = Schema.Boolean.pipe(
  Schema.withDecodingDefaultType(Effect.succeed(false))
);

export const limit = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
);

export const urlPayload = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(4096)),
});

export const subscribePayload = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(4096)),
  title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
});

export const batchIds = <Id extends Schema.Top>(id: Id) =>
  Schema.Struct({ ids: Schema.Array(id).check(Schema.isMaxLength(5000)) });

export const ok = Schema.Struct({ ok: Schema.Boolean });

export const created = <S extends Schema.Top>(schema: S) =>
  schema.pipe(HttpApiSchema.status(201));
