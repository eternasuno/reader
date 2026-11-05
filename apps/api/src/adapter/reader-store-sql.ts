import {
  Article,
  ArticleRepositoryError,
  Feed,
  FeedRepositoryError,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import type { Surreal } from 'surrealdb';

export type Bindings = Record<string, unknown>;

export const articleRepositoryError = () =>
  new ArticleRepositoryError({ message: 'Failed to access articles' });

export const feedRepositoryError = () =>
  new FeedRepositoryError({ message: 'Failed to access feeds' });

export const run = <A, E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: (cause: unknown) => E
) =>
  Effect.tryPromise({
    try: () => db.query<Array<A>>(sql, bindings),
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
  read(db, sql, bindings, Schema.Array(Article), articleRepositoryError);

export const subscriptions = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(Feed), feedRepositoryError);

export const write = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) => run<unknown, E>(db, sql, bindings, onError).pipe(Effect.asVoid);
