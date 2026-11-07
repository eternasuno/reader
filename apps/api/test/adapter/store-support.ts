import { createHash, randomUUID } from 'node:crypto';
import {
  Feed,
  FeedItem,
  type FeedItemRepository,
  type FeedRepository,
  OwnerId,
  SavedPage,
  type SavedPageRepository,
} from '@reader/business';
import { Effect, Layer, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  ReaderStoreLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { createSurreal, Database } from '../../src/infrastructure/db';

export type Store =
  | FeedItemRepository
  | SavedPageRepository
  | FeedRepository
  | Database;

export const hash = (...values: Array<string>) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

export const owner = (value: string) => Schema.decodeSync(OwnerId)(value);

export const dateTime = (value: string) =>
  Schema.decodeSync(Schema.DateTimeUtcFromString)(value);

export const feed = (
  ownerId: string,
  url: string,
  updatedAt: string,
  id?: string
) =>
  Schema.decodeSync(Feed)({
    id: id ?? hash(ownerId, url),
    ownerId,
    url,
    title: url,
    updatedAt: new Date(updatedAt),
  });

type ItemOptions = {
  readonly id?: string;
  readonly publishedAt?: string;
  readonly read?: boolean;
  readonly title?: string;
};

export const feedItem = (
  feedId: string,
  seed: string,
  options: ItemOptions = {}
) =>
  Schema.decodeSync(FeedItem)({
    id: options.id ?? hash(feedId, seed),
    feedId,
    title: options.title ?? seed,
    publishedAt: new Date(options.publishedAt ?? '2026-01-01T00:00:00.000Z'),
    read: options.read ?? false,
  });

export const savedPage = (
  ownerId: string,
  seed: string,
  options: ItemOptions = {}
) =>
  Schema.decodeSync(SavedPage)({
    id: options.id ?? hash(ownerId, seed),
    ownerId,
    title: options.title ?? seed,
    content: `<p>${seed}</p>`,
    publishedAt: new Date(options.publishedAt ?? '2026-01-01T00:00:00.000Z'),
    read: options.read ?? false,
  });

export const sorted = (values: ReadonlyArray<string>) => [...values].sort();

export const ids = <A extends { readonly id: string }, E, R>(
  effect: Effect.Effect<ReadonlyArray<A>, E, R>
) => effect.pipe(Effect.map((items) => items.map((item) => item.id)));

export const query = <A>(
  db: Surreal,
  sql: string,
  bindings: Record<string, unknown> = {}
) =>
  Effect.promise(async () => {
    const [rows] = await db.query<[Array<A>]>(sql, bindings);

    return rows;
  });

export const runCheck = <A, E>(
  check: (db: Surreal) => Effect.Effect<A, E, Store>
) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `reader-store-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(check(db)),
        Effect.provide(
          Layer.merge(
            ReaderStoreLive.pipe(Layer.provide(Layer.succeed(Database, db))),
            Layer.succeed(Database, db)
          )
        )
      ),
    (db) => Effect.promise(() => db.close())
  );
