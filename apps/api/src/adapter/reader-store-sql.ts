import {
  FeedItemRepositoryError,
  FeedRepositoryError,
  SavedPageRepositoryError,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';

export type Bindings = Record<string, unknown>;

export const feedRepositoryError = () =>
  new FeedRepositoryError({ message: 'Failed to access feeds' });

export const feedItemRepositoryError = () =>
  new FeedItemRepositoryError({ message: 'Failed to access feed items' });

export const savedPageRepositoryError = () =>
  new SavedPageRepositoryError({ message: 'Failed to access saved pages' });

export const run = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) =>
  Effect.tryPromise({
    try: () => db.query<Array<unknown>>(sql, bindings),
    catch: onError,
  }).pipe(Effect.uninterruptible);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const omitNone = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(omitNone);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, omitNone(field)])
  );
};

const decode = <A, E>(
  value: unknown,
  schema: Schema.ConstraintDecoder<A>,
  onError: () => E
) =>
  Schema.decodeUnknownEffect(schema)(omitNone(value)).pipe(
    Effect.mapError(onError)
  );

export const readRows = <A, E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  schema: Schema.ConstraintDecoder<A>,
  onError: () => E
) =>
  run(db, sql, bindings, onError).pipe(
    Effect.flatMap((results) =>
      decode(results[0] ?? [], Schema.Array(schema), onError)
    )
  );

export const decodeReturned = <A, E>(
  results: ReadonlyArray<unknown>,
  schema: Schema.ConstraintDecoder<A>,
  onError: () => E
) => decode(results.at(-1) ?? [], schema, onError);

export const write = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) => run(db, sql, bindings, onError).pipe(Effect.asVoid);

export const createdIds = <Id>(
  rows: ReadonlyArray<{ readonly id: Id }>,
  results: ReadonlyArray<unknown>
): ReadonlyArray<Id> => {
  const flags = results.at(-1);

  if (!Array.isArray(flags)) {
    return [];
  }

  return rows.flatMap((row, index) => (flags[index] === true ? [row.id] : []));
};

export const recordsOf = (table: string, ids: ReadonlyArray<string>) =>
  ids.map((id) => new RecordId(table, id));

export const afterClause = (column: string, after: string | undefined) =>
  after === undefined ? '' : ` AND ${column} < $after`;
