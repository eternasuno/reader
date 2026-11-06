import {
  Brand,
  Effect,
  Option,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from 'effect';
import {
  FeedId,
  NormalizedUrl,
  OptionalTrimmedString,
  OwnerId,
} from './object-value';

export const ArticleId = Schema.String.pipe(Schema.brand('ArticleId'));

export type ArticleId = typeof ArticleId.Type;

export const ArticleFilter = Schema.Literals(['all', 'unread', 'read']);

export type ArticleFilter = typeof ArticleFilter.Type;

export const ArticleTitle = Schema.Trim.pipe(
  Schema.decode(
    SchemaTransformation.transform({
      decode: (title) => title || 'Untitled',
      encode: (title) => title,
    })
  ),
  Schema.brand('ArticleTitle')
);

export type ArticleTitle = typeof ArticleTitle.Type;

export const ArticleDescription = OptionalTrimmedString.pipe(
  Schema.brand('ArticleDescription')
);

export type ArticleDescription = typeof ArticleDescription.Type;

const brandArticleDescription = Brand.nominal<ArticleDescription>();

export const articleDescription = (
  value: OptionalTrimmedString
): ArticleDescription => brandArticleDescription(value);

export const ArticleContent = OptionalTrimmedString.pipe(
  Schema.brand('ArticleContent')
);

export type ArticleContent = typeof ArticleContent.Type;

const brandArticleContent = Brand.nominal<ArticleContent>();

export const articleContent = (value: OptionalTrimmedString): ArticleContent =>
  brandArticleContent(value);

export const Article = Schema.Struct({
  id: ArticleId,
  ownerId: OwnerId,
  feedId: Schema.OptionFromOptional(FeedId),
  url: Schema.OptionFromOptional(NormalizedUrl),
  title: ArticleTitle,
  description: ArticleDescription,
  content: ArticleContent,
  extractedContent: ArticleContent,
  publishedAt: Schema.DateTimeUtcFromDate,
  read: Schema.Boolean,
});

export type Article = typeof Article.Type;

export const ArticleCursorScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['later']) }),
  Schema.Struct({
    kind: Schema.Literals(['feeds']),
    feedId: Schema.OptionFromOptional(FeedId),
  }),
]);

export type ArticleCursorScope = typeof ArticleCursorScope.Type;

export const ArticleCursorPayload = Schema.Struct({
  version: Schema.Literals([1]),
  owner: OwnerId,
  scope: ArticleCursorScope,
  filter: ArticleFilter,
  after: Schema.Struct({
    publishedAt: Schema.DateTimeUtcFromString,
    id: ArticleId,
  }),
});

export type ArticleCursor = typeof ArticleCursorPayload.Type;

export type ArticleCursorPosition = {
  readonly owner: OwnerId;
  readonly scope: ArticleCursorScope;
  readonly filter: ArticleFilter;
  readonly publishedAt: string;
  readonly id: ArticleId;
};

const encodeBase64 = (value: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const decodeBase64 = (value: string): string => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

const ArticleCursorJson = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transformEffect<unknown, string>({
      decode: (value, options) =>
        Effect.try({
          try: () => JSON.parse(decodeBase64(value)),
          catch: () =>
            new SchemaIssue.InvalidValue(
              { message: 'Invalid pagination cursor' },
              value,
              options
            ),
        }),
      encode: (payload) =>
        Effect.succeed(encodeBase64(JSON.stringify(payload))),
    })
  )
);

export const ArticleCursorFromString = ArticleCursorJson.pipe(
  Schema.decodeTo(ArticleCursorPayload)
);

const scopeEncoded = (
  scope: ArticleCursorScope
): typeof ArticleCursorScope.Encoded =>
  scope.kind === 'later'
    ? { kind: 'later' }
    : {
        kind: 'feeds',
        ...(Option.isSome(scope.feedId) ? { feedId: scope.feedId.value } : {}),
      };

export const encodeArticleCursor = ({
  owner,
  scope,
  filter,
  publishedAt,
  id,
}: ArticleCursorPosition): string => {
  const payload: typeof ArticleCursorPayload.Encoded = {
    version: 1,
    owner,
    scope: scopeEncoded(scope),
    filter,
    after: { publishedAt, id },
  };

  return encodeBase64(JSON.stringify(payload));
};
