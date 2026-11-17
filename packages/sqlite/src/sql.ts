import type { OwnerId } from '@reader/business';
import { DateTime, Effect, Option, Schema } from 'effect';
import type { SqlClient, SqlError, Statement } from 'effect/sql';

type Row = Readonly<Record<string, unknown>>;

const withoutNulls = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));

/**
 * Decodes rows, dropping NULL columns first so an absent optional column
 * decodes as none instead of failing the schema (database.md).
 */
export const decodeRows =
  <A>(
    schema: Schema.ConstraintDecoder<A>,
    fromRow: (row: Row) => Row = (row) => row
  ) =>
  (rows: ReadonlyArray<Row>) => {
    const decode = Schema.decodeEffect(Schema.Array(schema));

    return decode(rows.map((row) => withoutNulls(fromRow(row))));
  };

/**
 * Logs the original cause and fails with the port error. The message is a
 * debugging aid and stays server-side (database.md).
 */
export const failWith =
  <E extends { readonly message: string }>(makeError: () => E) =>
  <A, R>(effect: Effect.Effect<A, unknown, R>) =>
    effect.pipe(
      Effect.tapError((cause) => Effect.logError(makeError().message, cause)),
      Effect.mapError(() => makeError())
    );

/** Turns an epoch-milliseconds column into the `Date` the entity schemas decode. */
export const dateFromMillis = (value: unknown): unknown =>
  typeof value === 'number' ? new Date(value) : value;

/** Binds none as NULL. */
export const millisOrNull = (
  value: Option.Option<DateTime.Utc>
): number | null => Option.getOrNull(Option.map(value, DateTime.toEpochMillis));

export const first = <A>(rows: ReadonlyArray<A>): Option.Option<A> =>
  Option.fromUndefinedOr(rows[0]);

export const changed = (rows: ReadonlyArray<unknown>): boolean =>
  rows.length > 0;

/**
 * Inserts each row in one transaction and returns the ids actually created
 * (CM-PORT-3, CM-PORT-6); rows of another owner are never written.
 */
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

/**
 * Binds the whole list as one JSON parameter read with `json_each`, so no
 * SQLite variable limit applies (database.md).
 */
export const inList = (
  sql: SqlClient.SqlClient,
  column: string,
  values: ReadonlyArray<string>
) =>
  sql`${sql(column)} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

/**
 * One keyset clause for the three feed-item lists and the saved-page list
 * (database.md): unread filter, cursor, newest first.
 */
export const page = (
  sql: SqlClient.SqlClient,
  query: {
    readonly unread: boolean;
    readonly cursor: Option.Option<string>;
    readonly limit: number;
  }
): Statement.Fragment => {
  const cursor = Option.getOrNull(query.cursor);

  return sql`${query.unread ? sql` AND read = 0` : sql.literal('')}${cursor === null ? sql.literal('') : sql` AND id < ${cursor}`} ORDER BY id DESC LIMIT ${query.limit}`;
};
