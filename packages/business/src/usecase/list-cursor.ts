import { Data, type DateTime, Schema } from 'effect';
import { FeedId } from '../entity/feed/feed';
import { OwnerId } from '../entity/object-value/owner-id';
import { ReadFilter } from '../port/read-filter';

export class InvalidCursor extends Data.TaggedError('InvalidCursor')<{
  readonly message: string;
}> {}

export const ListCursorScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['saved']) }),
  Schema.Struct({
    kind: Schema.Literals(['feeds']),
    feedId: Schema.OptionFromOptional(FeedId),
  }),
]);

export type ListCursorScope = typeof ListCursorScope.Type;

export const ListCursorPayload = Schema.Struct({
  version: Schema.Literals([1]),
  owner: OwnerId,
  scope: ListCursorScope,
  filter: ReadFilter,
  after: Schema.Struct({
    publishedAt: Schema.Union([
      Schema.DateTimeUtcFromString,
      Schema.DateTimeUtcFromMillis,
      Schema.DateTimeUtcFromDate,
    ]),
    id: Schema.String,
  }),
});

export type ListCursor = typeof ListCursorPayload.Type;

export type ListCursorPosition = {
  readonly owner: OwnerId;
  readonly scope: ListCursorScope;
  readonly filter: ReadFilter;
  readonly publishedAt: DateTime.Utc;
  readonly id: string;
};

export const ListCursorFromString = Schema.StringFromBase64.pipe(
  Schema.decodeTo(Schema.fromJsonString(ListCursorPayload))
);

export const encodeListCursor = ({
  owner,
  scope,
  filter,
  publishedAt,
  id,
}: ListCursorPosition): string =>
  Schema.encodeSync(ListCursorFromString)({
    version: 1,
    owner,
    scope,
    filter,
    after: { publishedAt, id },
  });
