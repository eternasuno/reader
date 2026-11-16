import type { OwnerId } from '@reader/business';
import { Effect, Schema } from 'effect';
import type { SqlClient, SqlError } from 'effect/sql';

type Row = Readonly<Record<string, unknown>>;

const withoutNulls = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));

export const decodeRows = <A, E>(
  rows: ReadonlyArray<Row>,
  schema: Schema.ConstraintDecoder<A>,
  onError: () => E
) =>
  Schema.decodeUnknownEffect(Schema.Array(schema))(rows.map(withoutNulls)).pipe(
    Effect.mapError(onError)
  );

export const dateFromMillis = (value: unknown) =>
  typeof value === 'number' ? new Date(value) : value;

export const createEach = <
  Input extends { readonly id: Id; readonly ownerId: OwnerId },
  Id = Input['id'],
>(
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  input: ReadonlyArray<Input>,
  insert: (
    row: Input
  ) => Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>
): Effect.Effect<ReadonlyArray<Id>, SqlError.SqlError> =>
  Effect.forEach(
    input.filter((row) => row.ownerId === owner),
    (row) =>
      insert(row).pipe(
        Effect.map((created) => (created.length > 0 ? [row.id] : []))
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

export const unreadClause = (sql: SqlClient.SqlClient, unreadOnly: boolean) =>
  unreadOnly ? sql` AND read = 0` : sql.literal('');

export const cursorClause = (
  sql: SqlClient.SqlClient,
  after: string | undefined
) => (after === undefined ? sql.literal('') : sql` AND id < ${after}`);
