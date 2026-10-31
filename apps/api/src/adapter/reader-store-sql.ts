import { Effect, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import * as Model from '../../../../packages/business/src/entity/model.ts';
import * as Port from '../../../../packages/business/src/port/reader-store.ts';

export type Bindings = Record<string, unknown>;

export const articleReadError = () =>
  new Port.ArticleReadError({ message: 'Failed to read articles' });

export const articleWriteError = () =>
  new Port.ArticleWriteError({ message: 'Failed to write articles' });

export const subscriptionReadError = () =>
  new Port.SubscriptionReadError({ message: 'Failed to read subscriptions' });

export const subscriptionWriteError = () =>
  new Port.SubscriptionWriteError({ message: 'Failed to write subscriptions' });

export const run = <A, E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: (cause: unknown) => E
) =>
  Effect.tryPromise({
    try: () => db.query<A[]>(sql, bindings),
    catch: onError,
  });

export const one = <A, E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: (cause: unknown) => E
) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, bindings),
    catch: onError,
  }).pipe(Effect.map(([result]) => result));

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

export const read = <A, E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  schema: Schema.ConstraintDecoder<A>,
  onError: () => E
) =>
  one<unknown, E>(db, sql, bindings, onError).pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknownEffect(schema)(omitNone(rows)).pipe(
        Effect.mapError(onError)
      )
    )
  );

export const articles = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(Model.Article), articleReadError);

export const subscriptions = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(Model.Feed), subscriptionReadError);

export const write = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) => run<unknown, E>(db, sql, bindings, onError).pipe(Effect.asVoid);
