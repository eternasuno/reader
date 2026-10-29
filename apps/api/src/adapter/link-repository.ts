import { createHash } from 'node:crypto';
import {
  LinkRepository,
  LinkRepositoryError,
  type ReadingLink,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../infrastructure/db';

const query = <A>(
  db: Surreal,
  sql: string,
  bindings: Record<string, unknown>
) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, bindings),
    catch: (cause) => new LinkRepositoryError({ cause }),
  }).pipe(Effect.map(([items]) => items));

const run = (db: Surreal, sql: string, bindings: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () => db.query(sql, bindings),
    catch: (cause) => new LinkRepositoryError({ cause }),
  }).pipe(Effect.asVoid);

const insertLink = (
  db: Surreal,
  owner: string,
  item: Omit<ReadingLink, 'key'>
) =>
  Effect.suspend(() => {
    const key = createHash('sha256')
      .update(JSON.stringify([owner, item.url]))
      .digest('hex');

    return query<ReadingLink[]>(
      db,
      'UPSERT type::record("reading_link", $key) SET owner = $owner, url = $url, title = $title, key = $key, createdAt = $createdAt, read = $read WHERE owner = NONE RETURN key, url, title, createdAt, read;',
      { owner, key, ...item }
    ).pipe(Effect.map((items) => items[0]));
  });

const updateLoadedRead = (
  db: Surreal,
  owner: string,
  keys: readonly string[]
) =>
  run(
    db,
    'UPDATE reading_link SET read = true WHERE owner = $owner AND key IN $keys AND read = false;',
    { owner, keys }
  );

export const LinkRepositoryLive = Layer.effect(
  LinkRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return LinkRepository.of({
      list: (
        owner,
        read,
        offset,
        limit,
        all = false,
        before = '',
        beforeKey = ''
      ) =>
        query<ReadingLink[]>(
          db,
          'SELECT key, url, title, createdAt, read FROM reading_link WHERE owner = $owner AND ($all = true OR read = $read) AND ($before = "" OR createdAt < $before OR (createdAt = $before AND key < $beforeKey)) ORDER BY createdAt DESC, key DESC LIMIT $limit START $offset;',
          { owner, read, all, before, beforeKey, offset, limit }
        ),
      unreadCount: (owner) =>
        query<{ count: number }[]>(
          db,
          'SELECT count() AS count FROM reading_link WHERE owner = $owner AND read = false GROUP ALL;',
          { owner }
        ).pipe(Effect.map(([row]) => row?.count ?? 0)),
      insert: (owner, item) => insertLink(db, owner, item),
      mark: (owner, key, read) =>
        query<ReadingLink[]>(
          db,
          'UPDATE reading_link SET read = $read WHERE owner = $owner AND key = $key RETURN AFTER;',
          { owner, key, read }
        ).pipe(Effect.map((items) => items.length > 0)),
      markAll: (owner) =>
        query<ReadingLink[]>(
          db,
          'UPDATE reading_link SET read = true WHERE owner = $owner AND read = false;',
          { owner }
        ).pipe(Effect.asVoid),
      markLoaded: (owner, keys) => updateLoadedRead(db, owner, keys),
      remove: (owner, key) =>
        query<ReadingLink[]>(
          db,
          'DELETE reading_link WHERE owner = $owner AND key = $key RETURN BEFORE;',
          { owner, key }
        ).pipe(Effect.map((items) => items.length > 0)),
    });
  })
);
