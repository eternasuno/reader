import { FolderId } from '@reader/business';
import { Effect, Schema } from 'effect';
import { HttpApiSchema } from 'effect/http-api';

const failure = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({ _tag: Schema.Literal(tag) }).pipe(
    HttpApiSchema.status(status)
  );

const failureWithId = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({ _tag: Schema.Literal(tag), id: Schema.String }).pipe(
    HttpApiSchema.status(status)
  );

const failureWithUrl = <Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({ _tag: Schema.Literal(tag), url: Schema.String }).pipe(
    HttpApiSchema.status(status)
  );

const UnauthorizedSchema = failure('Unauthorized', 401);

const ForbiddenSchema = failure('Forbidden', 403);

export const InvalidPageUrlSchema = failure('InvalidPageUrl', 400);

export const FeedUrlInvalidSchema = failure('FeedUrlInvalid', 400);

export const InvalidRetentionSchema = failure('InvalidRetention', 400);

export const InvalidKeySchema = failure('InvalidKey', 400);

export const InvalidEndpointSchema = failure('InvalidEndpoint', 400);

export const InvalidFolderNameSchema = failure('InvalidFolderName', 400);

export const FeedItemNotFoundSchema = failureWithId('FeedItemNotFound', 404);

export const FolderNotFoundSchema = failureWithId('FolderNotFound', 404);

export const SavedPageAlreadyExistsSchema = failureWithUrl(
  'SavedPageAlreadyExists',
  409
);

export const FeedAlreadyExistsSchema = failureWithUrl('FeedAlreadyExists', 409);

export const FolderAlreadyExistsSchema = failure('FolderAlreadyExists', 409);

const ArticleEmptyContentSchema = failure('ArticleEmptyContent', 422);

const WebpageFetcherErrorSchema = failure('WebpageFetcherError', 422);

const ArticleExtractorErrorSchema = failure('ArticleExtractorError', 422);

export const FetchFeedErrorSchema = failure('FetchFeedError', 422);

export const FeedParserErrorSchema = failure('FeedParserError', 422);

export const BrowserEndpointRequiredSchema = failure(
  'BrowserEndpointRequired',
  422
);

const FeedItemRepositoryErrorSchema = failure('FeedItemRepositoryError', 500);

export const FeedRepositoryErrorSchema = failure('FeedRepositoryError', 500);

export const FolderRepositoryErrorSchema = failure(
  'FolderRepositoryError',
  500
);

const SavedPageRepositoryErrorSchema = failure('SavedPageRepositoryError', 500);

const SettingRepositoryErrorSchema = failure('SettingRepositoryError', 500);

export const authErrors = [UnauthorizedSchema, ForbiddenSchema];

export const savedPageErrors = [SavedPageRepositoryErrorSchema, ...authErrors];

export const feedItemErrors = [FeedItemRepositoryErrorSchema, ...authErrors];

export const folderErrors = [FolderRepositoryErrorSchema, ...authErrors];

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
