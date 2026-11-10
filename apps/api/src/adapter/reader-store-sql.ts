import {
  Feed,
  FeedItem,
  FeedItemRepositoryError,
  FeedRepositoryError,
  SavedPage,
  SavedPageRepositoryError,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import type { Surreal } from 'surrealdb';

export type Bindings = Record<string, unknown>;

export const feedItemRepositoryError = () =>
  new FeedItemRepositoryError({ message: 'Failed to access feed items' });

export const savedPageRepositoryError = () =>
  new SavedPageRepositoryError({ message: 'Failed to access saved pages' });

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

export const readClause = (isRead: boolean | undefined): string =>
  isRead === undefined ? '' : ' AND read = $read';

export const readBindings = (isRead: boolean | undefined): Bindings =>
  isRead === undefined ? {} : { read: isRead };

/**
 * List order is `publishedAt DESC, <id> DESC`. The plain `publishedAt` bound is
 * redundant for correctness but is what lets SurrealDB turn the clause into an
 * index range; without it the ordered index scan starts at the head of the list
 * and a deep page or refresh costs O(position).
 */
export const afterBoundary = (idColumn: string): string =>
  ` AND publishedAt <= $afterAt AND (publishedAt < $afterAt OR ${idColumn} < $afterId)`;

export const throughBoundary = (idColumn: string): string =>
  ` AND publishedAt >= $throughAt AND (publishedAt > $throughAt OR ${idColumn} >= $throughId)`;

export const feedItems = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(FeedItem), feedItemRepositoryError);

export const savedPages = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(SavedPage), savedPageRepositoryError);

export const subscriptions = (db: Surreal, sql: string, bindings: Bindings) =>
  read(db, sql, bindings, Schema.Array(Feed), feedRepositoryError);

export const write = <E>(
  db: Surreal,
  sql: string,
  bindings: Bindings,
  onError: () => E
) => run<unknown, E>(db, sql, bindings, onError).pipe(Effect.asVoid);
