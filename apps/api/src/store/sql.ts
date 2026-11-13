import {
  FeedItemRepositoryError,
  FeedRepositoryError,
  FolderRepositoryError,
  type OwnerId,
  SavedPageRepositoryError,
  SettingRepositoryError,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';

export type Bindings = Record<string, unknown>;

export const feedRepositoryError = () =>
  new FeedRepositoryError({ message: 'Failed to access feeds' });

export const feedItemRepositoryError = () =>
  new FeedItemRepositoryError({ message: 'Failed to access feed items' });

export const folderRepositoryError = () =>
  new FolderRepositoryError({ message: 'Failed to access folders' });

export const savedPageRepositoryError = () =>
  new SavedPageRepositoryError({ message: 'Failed to access saved pages' });

export const settingRepositoryError = () =>
  new SettingRepositoryError({
    message: 'Failed to access extraction settings',
  });

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

export const write = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) => run(db, sql, bindings, onError).pipe(Effect.asVoid);

const createdIds = <Id>(
  rows: ReadonlyArray<{ readonly id: Id }>,
  results: ReadonlyArray<unknown>
): ReadonlyArray<Id> => {
  const flags = results.at(-1);

  if (!Array.isArray(flags)) {
    return [];
  }

  return rows.flatMap((row, index) => (flags[index] === true ? [row.id] : []));
};

export const createRows = <
  Row extends { readonly id: Id; readonly ownerId: OwnerId },
  Id = Row['id'],
  E = never,
>(
  db: Surreal,
  owner: OwnerId,
  input: ReadonlyArray<Row>,
  options: {
    readonly prefix: string;
    readonly encode: (row: Row) => unknown;
    readonly statement: (binding: string, index: number) => string;
    readonly onError: () => E;
  }
): Effect.Effect<ReadonlyArray<Id>, E> => {
  const rows = input.filter((row) => row.ownerId === owner);

  if (rows.length === 0) {
    return Effect.succeed([] as ReadonlyArray<Id>);
  }

  const bindings: Bindings = { owner };
  rows.forEach((row, index) => {
    bindings[`${options.prefix}${index}`] = options.encode(row);
  });
  const statements = rows
    .map((_, index) => options.statement(`$${options.prefix}${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`,
    bindings,
    options.onError
  ).pipe(Effect.map((results) => createdIds(rows, results)));
};

export const recordsOf = (table: string, ids: ReadonlyArray<string>) =>
  ids.map((id) => new RecordId(table, id));

export const afterClause = (column: string, after: string | undefined) =>
  after === undefined ? '' : ` AND ${column} < $after`;
