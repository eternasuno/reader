import { type DateTime, Schema } from 'effect';
import { ArticleId } from '../entity/article';
import { FeedId, OwnerId } from '../entity/object-value';

export const ArticleFilter = Schema.Literals(['all', 'unread', 'read']);

export type ArticleFilter = typeof ArticleFilter.Type;

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
    publishedAt: Schema.Union([
      Schema.DateTimeUtcFromString,
      Schema.DateTimeUtcFromMillis,
      Schema.DateTimeUtcFromDate,
    ]),
    id: ArticleId,
  }),
});

export type ArticleCursor = typeof ArticleCursorPayload.Type;

export type ArticleCursorPosition = {
  readonly owner: OwnerId;
  readonly scope: ArticleCursorScope;
  readonly filter: ArticleFilter;
  readonly publishedAt: DateTime.Utc;
  readonly id: ArticleId;
};

export const ArticleCursorFromString = Schema.StringFromBase64.pipe(
  Schema.decodeTo(Schema.fromJsonString(ArticleCursorPayload))
);

export const encodeArticleCursor = ({
  owner,
  scope,
  filter,
  publishedAt,
  id,
}: ArticleCursorPosition): string =>
  Schema.encodeSync(ArticleCursorFromString)({
    version: 1,
    owner,
    scope,
    filter,
    after: { publishedAt, id },
  });
