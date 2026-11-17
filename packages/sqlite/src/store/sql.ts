import type { OwnerId } from '@reader/business';
import { DateTime, Effect, Option, Schema } from 'effect';
import type { SqlClient, SqlError, Statement } from 'effect/sql';

type Row = Readonly<Record<string, unknown>>;

const withoutNulls = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));

export const decodeRows = <A>(
  schema: Schema.ConstraintDecoder<A>,
  fromRow: (row: Row) => Row = (row) => row
) => {
  const decode = Schema.decodeEffect(Schema.Array(schema));

  return (rows: ReadonlyArray<Row>) =>
    decode(rows.map((row) => withoutNulls(fromRow(row))));
};

export const failWith =
  <E extends { readonly message: string }>(makeError: () => E) =>
  <A, R>(effect: Effect.Effect<A, unknown, R>) =>
    effect.pipe(
      Effect.tapError((cause) => Effect.logError(makeError().message, cause)),
      Effect.mapError(makeError)
    );

export const dateFromMillis = (value: unknown) =>
  typeof value === 'number' ? new Date(value) : value;

export const millisOrNull = (value: Option.Option<DateTime.Utc>) =>
  Option.getOrNull(Option.map(value, DateTime.toEpochMillis));

export const first = <A>(rows: ReadonlyArray<A>) =>
  Option.fromUndefinedOr(rows[0]);

export const changed = (rows: ReadonlyArray<unknown>) => rows.length > 0;

export const createEach = <
  Input extends { readonly id: string; readonly ownerId: OwnerId },
>(
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  rows: ReadonlyArray<Input>,
  insert: (
    row: Input
  ) => Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>
): Effect.Effect<ReadonlyArray<Input['id']>, SqlError.SqlError> =>
  Effect.forEach(
    rows.filter((row) => row.ownerId === owner),
    (row) =>
      insert(row).pipe(
        Effect.map((created) => (changed(created) ? [row.id] : []))
      )
  ).pipe(
    Effect.map((ids) => ids.flat()),
    sql.withTransaction
  );

export const inList = (
  sql: SqlClient.SqlClient,
  column: string,
  values: ReadonlyArray<string>
) =>
  sql`${sql(column)} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

export const page = (
  sql: SqlClient.SqlClient,
  query: {
    readonly unreadOnly: boolean;
    readonly after?: string;
    readonly limit: number;
  }
): Statement.Fragment =>
  sql`${query.unreadOnly ? sql` AND read = 0` : sql.literal('')}${query.after === undefined ? sql.literal('') : sql` AND id < ${query.after}`} ORDER BY id DESC LIMIT ${query.limit}`;
